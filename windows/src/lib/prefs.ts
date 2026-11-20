// Non-secret settings in localStorage (shared by all windows of the app). Secrets: see native.ts.
import { secrets } from "./native";

export type Appearance = "system" | "light" | "dark";
export type Edge = "left" | "right";
/** Edge notch, a floating island, or nothing on screen until you click the tray icon. */
export type NotchStyle = "edge" | "island" | "tray";
export type IslandPos = "topLeft" | "top" | "topRight" | "bottomLeft" | "bottomRight";
export type TextSize = "standard" | "large" | "larger";

export const TEXT_SCALE: Record<TextSize, number> = { standard: 1, large: 1.15, larger: 1.3 };

/** A saved project + task for quick entries (stored locally; Keito's API has no favourites). */
export interface Favorite {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
}

export interface Prefs {
  keitoAccountId: string;
  jiraSite: string;
  jiraEmail: string;
  googleClientId: string;
  /** Google Calendar connected ("Log from calendar"). */
  calendarEnabled: boolean;
  /** Calendars to read; null = primary only. */
  googleCalendarIds: string[] | null;
  style: NotchStyle;
  edge: Edge;
  /** Edge style: 0 = top … 1 = bottom of the screen. */
  position: number;
  island: IslandPos;
  /** "main" | "active" | a monitor name. */
  display: string;
  textSize: TextSize;
  expandOnHover: boolean;
  idleReminder: boolean;
  showSeconds: boolean;
  appearance: Appearance;
  /** JS weekdays (0 = Sunday … 6 = Saturday). With alternating weeks: the even weeks. */
  workdays: number[];
  /** Different work days in odd and even weeks (e.g. 4 days one week, 5 the next). */
  alternatingWeeks: boolean;
  oddWeekWorkdays: number[];
  /** Own hours per weekday instead of the capacity spread evenly. */
  customDayHours: boolean;
  /** Hours per JS weekday (even weeks with alternating weeks); 0 = day off. */
  dayHours: Record<number, number>;
  oddWeekDayHours: Record<number, number>;
  favorites: Favorite[];
  /** Check for updates once a day. */
  autoUpdateCheck: boolean;
  /** Install updates without asking. */
  autoInstall: boolean;
  lastUpdateCheck: number;
  lastProjectId: string | null;
  lastTaskId: string | null;
}

const DEFAULTS: Prefs = {
  keitoAccountId: "",
  jiraSite: "",
  jiraEmail: "",
  googleClientId: "",
  calendarEnabled: false,
  googleCalendarIds: null,
  style: "edge",
  edge: "right",
  position: 0.42,
  island: "top",
  display: "main",
  textSize: "standard",
  expandOnHover: true,
  idleReminder: true,
  showSeconds: false,
  appearance: "system",
  workdays: [1, 2, 3, 4, 5],
  alternatingWeeks: false,
  oddWeekWorkdays: [1, 2, 3, 4, 5],
  customDayHours: false,
  dayHours: {},
  oddWeekDayHours: {},
  favorites: [],
  autoUpdateCheck: true,
  autoInstall: false,
  lastUpdateCheck: 0,
  lastProjectId: null,
  lastTaskId: null,
};

const KEY = "keitonotch.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<Prefs>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: settings last for this session only.
  }
  return next;
}

/** Shipped Google client (optional): from .env at build time. Google treats desktop client secrets as non-confidential. */
export const bundledGoogle = {
  clientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "",
  clientSecret: (import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string | undefined) ?? "",
};

export interface Credentials {
  keitoAccountId: string;
  keitoApiKey: string;
  jiraHost: string;
  jiraEmail: string;
  jiraToken: string;
  googleClientId: string;
  googleClientSecret: string;
}

export const hasKeito = (c: Credentials) => !!c.keitoAccountId && !!c.keitoApiKey;
export const hasJira = (c: Credentials) => !!c.jiraHost && !!c.jiraEmail && !!c.jiraToken;
export const hasGoogleClient = (c: Credentials) => !!c.googleClientId && !!c.googleClientSecret;

/** "https://acme.atlassian.net/" → "acme.atlassian.net". */
export function normaliseHost(site: string): string {
  return site.trim().replace(/^https?:\/\//, "").replace(/[/\s]+$/, "");
}

export async function loadCredentials(): Promise<Credentials> {
  const p = loadPrefs();
  const [keitoApiKey, jiraToken, googleSecret] = await Promise.all([
    secrets.get("keito.apiKey").catch(() => null),
    secrets.get("jira.token").catch(() => null),
    secrets.get("google.clientSecret").catch(() => null),
  ]);
  return {
    keitoAccountId: p.keitoAccountId.trim(),
    keitoApiKey: keitoApiKey ?? "",
    jiraHost: normaliseHost(p.jiraSite),
    jiraEmail: p.jiraEmail.trim(),
    jiraToken: jiraToken ?? "",
    googleClientId: p.googleClientId.trim() || bundledGoogle.clientId,
    googleClientSecret: googleSecret ?? (p.googleClientId.trim() ? "" : bundledGoogle.clientSecret),
  };
}
