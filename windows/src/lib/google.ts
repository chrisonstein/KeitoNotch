// Google Calendar (read-only): OAuth for installed apps (PKCE + loopback) and Calendar API v3.
// Port of GoogleAuth.swift + GoogleCalendarClient.swift. The refresh token lives in Credential Manager.
import { http, native, openExternal, secrets } from "./native";
import type { CalendarEvent, CalendarInfo } from "./models";

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

/** A calendar problem in plain words, optionally with a one-click fix. */
export class CalendarProblem extends Error {
  constructor(public title: string, public detail: string, public fixLabel?: string, public fixUrl?: string) {
    super(`${title}. ${detail}`);
  }

  static from(e: unknown): CalendarProblem {
    if (e instanceof CalendarProblem) return e;
    if (e instanceof NotSignedIn) return new CalendarProblem("Google Calendar", "Sign in with Google to see your calendar.");
    return new CalendarProblem("Couldn't load your calendar", e instanceof Error ? e.message : String(e));
  }

  /** Google's JSON error body → readable. */
  static google(status: number, body: string): CalendarProblem {
    let err: { message?: string; details?: { reason?: string; metadata?: Record<string, string> }[] } | undefined;
    try {
      err = JSON.parse(body).error;
    } catch {
      err = undefined;
    }
    const message = err?.message ?? "";
    const reasons = (err?.details ?? []).map((d) => d.reason);
    if (reasons.includes("SERVICE_DISABLED") || message.includes("has not been used in project") || message.includes("is disabled")) {
      const activation = err?.details?.map((d) => d.metadata?.activationUrl).find(Boolean);
      const project = /project (\d+)/.exec(message)?.[1];
      return new CalendarProblem(
        "Google Calendar API isn't enabled",
        "Your sign-in worked, but the Google Cloud project behind this OAuth client hasn't switched on the Calendar API. Enable it, wait a minute, then refresh.",
        "Enable Calendar API",
        activation ?? `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com${project ? `?project=${project}` : ""}`,
      );
    }
    switch (status) {
      case 401: return new CalendarProblem("Google sign-in expired", "Sign in with Google again.");
      case 403: return new CalendarProblem("Google refused access", message || "Your account may not allow third-party calendar access.");
      case 429: return new CalendarProblem("Google is rate-limiting", "Wait a moment and refresh.");
      default: return new CalendarProblem("Couldn't load your calendar", message || `Google answered with error ${status}.`);
    }
  }
}

export class NotSignedIn extends Error {
  constructor() {
    super("Sign in with Google to see your calendar.");
  }
}

function base64Url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafe(n: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(n)));
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

interface Tokens {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

export class GoogleAuth {
  private accessToken: string | null = null;
  private expiry = 0;

  constructor(private clientId: string, private clientSecret: string) {}

  async isSignedIn(): Promise<boolean> {
    return !!(await secrets.get("google.refreshToken").catch(() => null));
  }

  /** Opens the browser for consent and waits (up to 5 min) for Google to redirect back. */
  async signIn(): Promise<void> {
    if (!this.clientId || !this.clientSecret) throw new CalendarProblem("Google Calendar", "Add a Google OAuth client ID and secret in Settings.");
    const verifier = randomUrlSafe(48);
    const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const state = randomUrlSafe(16);
    const port = await native.oauthListen();
    const redirect = `http://127.0.0.1:${port}`;
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    for (const [k, v] of Object.entries({
      client_id: this.clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent",
    })) auth.searchParams.set(k, v);
    await openExternal(auth.toString());

    let params: Record<string, string>;
    try {
      params = await native.oauthWait(300);
    } catch {
      throw new CalendarProblem("Google Calendar", "Google sign-in timed out. Try again.");
    }
    if (params.error) throw new CalendarProblem("Google Calendar", `Google sign-in was cancelled (${params.error}).`);
    if (params.state !== state || !params.code) throw new CalendarProblem("Google Calendar", "Google sign-in failed: unexpected response.");
    const tokens = await this.tokenRequest({
      code: params.code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
      code_verifier: verifier,
    });
    if (!tokens.refresh_token) throw new CalendarProblem("Google Calendar", "Google sign-in failed: no refresh token.");
    await secrets.set("google.refreshToken", tokens.refresh_token);
    this.store(tokens);
  }

  async signOut(): Promise<void> {
    const token = await secrets.get("google.refreshToken").catch(() => null);
    if (token) {
      // Best effort: also revoke the grant at Google.
      http("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ token }),
      }).catch(() => undefined);
    }
    await secrets.set("google.refreshToken", null);
    this.accessToken = null;
    this.expiry = 0;
  }

  async validAccessToken(): Promise<string> {
    if (this.accessToken && this.expiry > Date.now() + 60_000) return this.accessToken;
    const refresh = await secrets.get("google.refreshToken").catch(() => null);
    if (!refresh) throw new NotSignedIn();
    try {
      const t = await this.tokenRequest({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refresh,
        grant_type: "refresh_token",
      });
      this.store(t);
      return t.access_token;
    } catch (e) {
      if (e instanceof Error && e.message.includes("invalid_grant")) {
        // Revoked or expired consent: start over.
        await secrets.set("google.refreshToken", null);
        throw new NotSignedIn();
      }
      throw e;
    }
  }

  private store(t: Tokens) {
    this.accessToken = t.access_token;
    this.expiry = Date.now() + t.expires_in * 1000;
  }

  private async tokenRequest(fields: Record<string, string>): Promise<Tokens> {
    const resp = await http("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form(fields),
    });
    const text = await resp.text();
    if (resp.status !== 200) throw new Error(`Google sign-in failed: ${text.slice(0, 200)}`);
    return JSON.parse(text) as Tokens;
  }
}

interface RawEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  eventType?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/** Google descriptions can contain HTML; keep the text for matching. */
const plainText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

/** Timed, not cancelled, not declined, not out-of-office / working-location. */
export function toEvent(r: RawEvent): CalendarEvent | null {
  if (r.status === "cancelled" || r.eventType === "outOfOffice" || r.eventType === "workingLocation") return null;
  if (r.attendees?.find((a) => a.self)?.responseStatus === "declined") return null;
  const s = r.start?.dateTime ? new Date(r.start.dateTime) : null; // all-day events only have `date`
  const e = r.end?.dateTime ? new Date(r.end.dateTime) : null;
  if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) return null;
  return { id: r.id, title: (r.summary ?? "").trim(), details: plainText(r.description ?? ""), start: s, end: e, link: r.htmlLink };
}

export class GoogleCalendarClient {
  constructor(private auth: GoogleAuth) {}

  async calendars(): Promise<CalendarInfo[]> {
    const data = (await this.get("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250")) as {
      items: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean; hidden?: boolean }[];
    };
    return data.items
      .filter((c) => !c.hidden)
      .map((c) => ({ id: c.id, title: c.summaryOverride ?? c.summary ?? c.id, colorHex: c.backgroundColor, isPrimary: !!c.primary }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.title.localeCompare(b.title));
  }

  async events(calendarId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", from.toISOString());
    url.searchParams.set("timeMax", to.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    const data = (await this.get(url.toString())) as { items: RawEvent[] };
    return data.items.map(toEvent).filter((e): e is CalendarEvent => !!e);
  }

  private async get(url: string): Promise<unknown> {
    const token = await this.auth.validAccessToken();
    const resp = await http(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await resp.text();
    if (!resp.ok) throw CalendarProblem.google(resp.status, text);
    return JSON.parse(text);
  }
}

/** Same meeting seen through two calendars. */
export const dedupeKey = (e: CalendarEvent) => `${e.title.toLowerCase()}|${e.start.getTime()}|${e.end.getTime()}`;
