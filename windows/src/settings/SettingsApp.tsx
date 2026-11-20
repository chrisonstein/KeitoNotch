// Settings window: Keito, Jira, Calendar, Notch, Work week, General.
// Secrets go to Windows Credential Manager and are never shown again — fields only say whether one is saved.
import { useEffect, useState, type ReactNode } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { KeitoClient, friendlyError } from "../lib/keito";
import { JiraClient } from "../lib/jira";
import { CalendarProblem, GoogleAuth, GoogleCalendarClient } from "../lib/google";
import { native, openExternal, secrets, type MonitorInfo, type SecretKey } from "../lib/native";
import {
  bundledGoogle, loadCredentials, loadPrefs, normaliseHost, savePrefs,
  type Credentials, type Favorite, type IslandPos, type NotchStyle, type Prefs, type TextSize,
} from "../lib/prefs";
import * as targets from "../lib/targets";
import { parseDayHours } from "../lib/targets";
import { weekNumber } from "../lib/dates";
import { checkForUpdate, installUpdate } from "../lib/updates";
import { projectColor } from "../notch/parts";
import { applyAppearance } from "../lib/appearance";
import * as fmt from "../lib/duration";
import type { CalendarInfo } from "../lib/models";
import { ArrowDown, ArrowUp, CalendarIcon, Key, Monitor, Power, Star, Ticket, Trash, Update as UpdateIcon, Week } from "../icons";

type Section = "keito" | "jira" | "calendar" | "notch" | "favorites" | "week" | "general";

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "keito", label: "Keito", icon: <Key /> },
  { id: "jira", label: "Jira", icon: <Ticket /> },
  { id: "calendar", label: "Calendar", icon: <CalendarIcon /> },
  { id: "notch", label: "Notch", icon: <Monitor /> },
  { id: "favorites", label: "Favourites", icon: <Star /> },
  { id: "week", label: "Work week", icon: <Week /> },
  { id: "general", label: "General", icon: <Power /> },
];

/** Where you create a Keito API key. Keito's docs give no deep link, so this opens the app. */
const KEITO_API_KEYS_URL = "https://app.keito.ai/";

/** Tell the notch something changed (credentials = reload data too). */
const changed = (credentials: boolean) => void emit("settings-changed", { credentials });

export function SettingsApp({ initialSection }: { initialSection: string }) {
  const [section, setSection] = useState<Section>((SECTIONS.find((s) => s.id === initialSection)?.id ?? "keito") as Section);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs());

  // The notch changed something (a favourite, a dragged position): show it.
  useEffect(() => {
    const onStorage = () => setPrefs(loadPrefs());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const off = listen<string>("settings-section", (e) => {
      if (SECTIONS.some((s) => s.id === e.payload)) setSection(e.payload as Section);
    });
    return () => void off.then((f) => f());
  }, []);

  /** Saves a non-secret preference and tells the notch. */
  const update = (patch: Partial<Prefs>, credentials = false) => {
    setPrefs(savePrefs(patch));
    if ("appearance" in patch) applyAppearance();
    changed(credentials);
  };

  return (
    <div className="settings">
      <nav className="side" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button key={s.id} className={section === s.id ? "active" : ""} aria-current={section === s.id} onClick={() => setSection(s.id)}>
            {s.icon} {s.label}
          </button>
        ))}
        <span className="spacer" />
        <button onClick={() => void native.quit()}><Power /> Quit Keito Notch</button>
      </nav>
      <main className="content">
        {section === "keito" && <KeitoSection prefs={prefs} />}
        {section === "jira" && <JiraSection prefs={prefs} />}
        {section === "calendar" && <CalendarSection prefs={prefs} update={update} />}
        {section === "notch" && <NotchSection prefs={prefs} update={update} />}
        {section === "favorites" && <FavoritesSection prefs={prefs} update={update} />}
        {section === "week" && <WeekSection prefs={prefs} update={update} />}
        {section === "general" && <GeneralSection prefs={prefs} update={update} />}
      </main>
    </div>
  );
}

// MARK: Building blocks

function Setting({ label, detail, children }: { label: string; detail?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="label">
        <div>{label}</div>
        {detail && <div>{detail}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  );
}

/** Password field that never shows the stored secret: empty = keep what's saved. */
function SecretInput({ saved, value, onChange, label }: { saved: boolean; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="password"
      aria-label={label}
      autoComplete="off"
      spellCheck={false}
      value={value}
      placeholder={saved ? "Saved in Credential Manager (type to replace)" : "Paste here"}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function useSaved(key: SecretKey): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    void secrets.get(key).then((v) => setSaved(!!v)).catch(() => setSaved(false));
  }, [key, n]);
  return [saved, () => setN((x) => x + 1)];
}

type Status = { ok: boolean; text: string } | null;
const StatusLine = ({ status }: { status: Status }) =>
  status ? <span className={`status ${status.ok ? "ok" : "bad"}`} role="status">{status.text}</span> : null;

// MARK: Keito

function KeitoSection({ prefs }: { prefs: Prefs }) {
  const [accountId, setAccountId] = useState(prefs.keitoAccountId);
  const [apiKey, setApiKey] = useState("");
  const [saved, refresh] = useSaved("keito.apiKey");
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const creds = async (): Promise<Credentials> => ({
    ...(await loadCredentials()),
    keitoAccountId: accountId.trim(),
    keitoApiKey: apiKey.trim() || (await secrets.get("keito.apiKey")) || "",
  });

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const c = await creds();
      const me = await new KeitoClient(c).me();
      savePrefs({ keitoAccountId: accountId.trim() });
      if (apiKey.trim()) await secrets.set("keito.apiKey", apiKey.trim());
      setApiKey("");
      refresh();
      changed(true);
      setStatus({ ok: true, text: `Connected as ${[me.first_name, me.last_name].filter(Boolean).join(" ") || "you"}${me.company?.name ? ` · ${me.company.name}` : ""}.` });
    } catch (e) {
      setStatus({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Keito</h1>
      <p className="lead">
        Create an API key in{" "}
        <a href="#" onClick={(e) => { e.preventDefault(); void openExternal(KEITO_API_KEYS_URL); }}>
          Keito → Settings → API keys
        </a>{" "}
        with <i>All permitted operations</i>, and copy your Company ID from the same page.
        The key is stored in Windows Credential Manager, never in a file.
      </p>
      <div className="group">
        <Setting label="Company ID" detail="Sent as Keito-Account-Id.">
          <input type="text" aria-label="Company ID" spellCheck={false} value={accountId} onChange={(e) => setAccountId(e.target.value)} />
        </Setting>
        <Setting label="API key">
          <SecretInput label="Keito API key" saved={saved} value={apiKey} onChange={setApiKey} />
        </Setting>
      </div>
      <div className="actions">
        <button className="pill primary" disabled={busy || !accountId.trim() || (!apiKey.trim() && !saved)} onClick={() => void save()}>
          {busy ? "Checking…" : "Save and test"}
        </button>
        <StatusLine status={status} />
      </div>
    </>
  );
}

// MARK: Jira

function JiraSection({ prefs }: { prefs: Prefs }) {
  const [site, setSite] = useState(prefs.jiraSite);
  const [email, setEmail] = useState(prefs.jiraEmail);
  const [token, setToken] = useState("");
  const [saved, refresh] = useSaved("jira.token");
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const c: Credentials = {
        ...(await loadCredentials()),
        jiraHost: normaliseHost(site),
        jiraEmail: email.trim(),
        jiraToken: token.trim() || (await secrets.get("jira.token")) || "",
      };
      const name = await new JiraClient(c).myself();
      savePrefs({ jiraSite: normaliseHost(site), jiraEmail: email.trim() });
      if (token.trim()) await secrets.set("jira.token", token.trim());
      setToken("");
      setSite(normaliseHost(site));
      refresh();
      changed(true);
      setStatus({ ok: true, text: `Connected as ${name}.` });
    } catch (e) {
      setStatus({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await secrets.set("jira.token", null);
    savePrefs({ jiraSite: "", jiraEmail: "" });
    setSite("");
    setEmail("");
    setToken("");
    refresh();
    changed(true);
    setStatus({ ok: true, text: "Jira disconnected." });
  };

  return (
    <>
      <h1>Jira</h1>
      <p className="lead">
        Optional: link entries to Jira tickets. Create an API token at{" "}
        <a href="#" onClick={(e) => { e.preventDefault(); void openExternal("https://id.atlassian.com/manage-profile/security/api-tokens"); }}>
          id.atlassian.com → Security → API tokens
        </a>.
      </p>
      <div className="group">
        <Setting label="Jira site" detail="e.g. yourcompany.atlassian.net">
          <input type="text" aria-label="Jira site" spellCheck={false} value={site} onChange={(e) => setSite(e.target.value)} />
        </Setting>
        <Setting label="E-mail" detail="The address you sign in to Atlassian with.">
          <input type="email" aria-label="Jira e-mail" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Setting>
        <Setting label="API token">
          <SecretInput label="Jira API token" saved={saved} value={token} onChange={setToken} />
        </Setting>
      </div>
      <div className="actions">
        <button className="pill primary" disabled={busy || !site.trim() || !email.trim() || (!token.trim() && !saved)} onClick={() => void save()}>
          {busy ? "Checking…" : "Save and test"}
        </button>
        {(saved || prefs.jiraSite) && <button className="pill outline" onClick={() => void disconnect()}>Disconnect</button>}
        <StatusLine status={status} />
      </div>
    </>
  );
}

// MARK: Calendar

function CalendarSection({ prefs, update }: { prefs: Prefs; update: (p: Partial<Prefs>) => void }) {
  const [clientId, setClientId] = useState(prefs.googleClientId);
  const [clientSecret, setClientSecret] = useState("");
  const [secretSaved, refreshSecret] = useSaved("google.clientSecret");
  const [signedIn, refreshSignedIn] = useSaved("google.refreshToken");
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CalendarProblem | null>(null);
  const usingBundled = !prefs.googleClientId && !!bundledGoogle.clientId;

  const auth = async () => {
    const c = await loadCredentials();
    return c.googleClientId && c.googleClientSecret ? new GoogleAuth(c.googleClientId, c.googleClientSecret) : null;
  };

  useEffect(() => {
    if (!signedIn || !prefs.calendarEnabled) {
      setCalendars([]);
      return;
    }
    void auth().then(async (a) => {
      if (!a) return;
      try {
        setCalendars(await new GoogleCalendarClient(a).calendars());
      } catch (e) {
        setProblem(CalendarProblem.from(e));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, prefs.calendarEnabled]);

  const saveClient = async () => {
    savePrefs({ googleClientId: clientId.trim() });
    if (clientSecret.trim()) await secrets.set("google.clientSecret", clientSecret.trim());
    if (!clientId.trim()) await secrets.set("google.clientSecret", null);
    setClientSecret("");
    refreshSecret();
    update({ googleClientId: clientId.trim() });
  };

  const signIn = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (clientId.trim() !== prefs.googleClientId || clientSecret.trim()) await saveClient();
      const a = await auth();
      if (!a) throw new CalendarProblem("Google Calendar", "Add a Google OAuth client ID and secret first.");
      await a.signIn();
      refreshSignedIn();
      update({ calendarEnabled: true });
      changed(true);
    } catch (e) {
      setProblem(CalendarProblem.from(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await (await auth())?.signOut();
    refreshSignedIn();
    update({ calendarEnabled: false, googleCalendarIds: null });
    changed(true);
  };

  const selected = prefs.googleCalendarIds ?? calendars.filter((c) => c.isPrimary).map((c) => c.id);
  const toggleCal = (id: string, on: boolean) => {
    const next = on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id);
    update({ googleCalendarIds: next });
  };

  return (
    <>
      <h1>Google Calendar</h1>
      <p className="lead">
        Optional: log meetings as time from the day view (<b>From calendar</b>, or press C). Keito Notch only reads your calendar, and stores
        the sign-in in Windows Credential Manager.
      </p>

      <div className="group">
        <Setting
          label="OAuth client ID"
          detail={usingBundled ? "Using your team's shared Google client. Fill in your own only if you need to." : "Google Cloud Console → Credentials → OAuth client ID → Desktop app."}
        >
          <input type="text" aria-label="Google OAuth client ID" spellCheck={false} value={clientId} placeholder={usingBundled ? "Team client" : ""} onChange={(e) => setClientId(e.target.value)} />
        </Setting>
        <Setting label="OAuth client secret">
          <SecretInput label="Google OAuth client secret" saved={secretSaved} value={clientSecret} onChange={setClientSecret} />
        </Setting>
      </div>

      <div className="actions">
        {signedIn && prefs.calendarEnabled ? (
          <>
            <span className="status ok">Connected to Google Calendar.</span>
            <button className="pill outline" onClick={() => void signOut()}>Disconnect</button>
          </>
        ) : (
          <button className="pill primary" disabled={busy || (!clientId.trim() && !usingBundled)} onClick={() => void signIn()}>
            {busy ? "Finish signing in in your browser…" : "Sign in with Google"}
          </button>
        )}
      </div>

      {problem && (
        <p className="status bad">
          {problem.title}. {problem.detail}{" "}
          {problem.fixUrl && <a href="#" onClick={(e) => { e.preventDefault(); void openExternal(problem.fixUrl!); }}>{problem.fixLabel}</a>}
        </p>
      )}

      {calendars.length > 0 && (
        <div className="group">
          <Setting label="Calendars to use" detail="A meeting that appears in two selected calendars is shown once.">
            <span />
          </Setting>
          <div className="cal-list">
            {calendars.map((c) => (
              <label key={c.id}>
                <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => toggleCal(c.id, e.target.checked)} />
                <span className="dot" style={{ background: c.colorHex ?? "var(--muted)" }} />
                {c.title}{c.isPrimary ? " (primary)" : ""}
              </label>
            ))}
          </div>
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
        Setting up a client (once per team): in Google Cloud Console enable the <i>Google Calendar API</i>, configure the OAuth consent screen
        (<i>Internal</i> for a Workspace org) and create an <i>OAuth client ID → Desktop app</i>. To ship it to everyone, put it in the build's
        <code> .env</code> file (see README).
      </p>
    </>
  );
}

// MARK: Notch

const ISLAND_LABELS: Record<IslandPos, string> = {
  topLeft: "Top left",
  top: "Top centre",
  topRight: "Top right",
  bottomLeft: "Bottom left",
  bottomRight: "Bottom right",
};

function NotchSection({ prefs, update }: { prefs: Prefs; update: (p: Partial<Prefs>) => void }) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  useEffect(() => {
    void native.monitors().then(setMonitors).catch(() => undefined);
  }, []);
  const knownDisplay = prefs.display === "main" || prefs.display === "active" || monitors.some((m) => m.name === prefs.display);
  return (
    <>
      <h1>Notch</h1>
      <p className="lead">Ctrl+Alt+T opens the day view from anywhere, and so does clicking the tray icon. Drag the notch to move it.</p>
      <div className="group">
        <Setting
          label="Style"
          detail={
            prefs.style === "edge" ? "Hugs the screen edge, with the ring tab."
              : prefs.style === "island" ? "A floating pill under the top of the screen or above the taskbar."
              : "Nothing on screen: click the tray icon (or Ctrl+Alt+T) to open the day view next to it."
          }
        >
          <select aria-label="Style" value={prefs.style} onChange={(e) => update({ style: e.target.value as NotchStyle })}>
            <option value="edge">Edge notch</option>
            <option value="island">Island</option>
            <option value="tray">Tray only</option>
          </select>
        </Setting>
        {prefs.style === "edge" && (
          <>
            <Setting label="Screen edge">
              <select aria-label="Screen edge" value={prefs.edge} onChange={(e) => update({ edge: e.target.value as Prefs["edge"] })}>
                <option value="right">Right</option>
                <option value="left">Left</option>
              </select>
            </Setting>
            <Setting label="Height on screen" detail="Or drag the tab up and down.">
              <input
                type="range"
                aria-label="Height on screen"
                min={0.04}
                max={0.96}
                step={0.01}
                value={prefs.position}
                style={{ width: 280 }}
                onChange={(e) => update({ position: +e.target.value })}
              />
            </Setting>
          </>
        )}
        {prefs.style === "island" && (
          <Setting label="Position" detail="Or drag the island; it snaps to the nearest spot.">
            <select aria-label="Island position" value={prefs.island} onChange={(e) => update({ island: e.target.value as IslandPos })}>
              {(Object.keys(ISLAND_LABELS) as IslandPos[]).map((k) => <option key={k} value={k}>{ISLAND_LABELS[k]}</option>)}
            </select>
          </Setting>
        )}
        {prefs.style !== "tray" && (
          <Setting
            label="Display"
            detail={prefs.display === "active"
              ? "Moves to the screen with the pointer (it waits while the notch is open)."
              : "A disconnected display falls back to the main one."}
          >
            <select aria-label="Display" value={knownDisplay ? prefs.display : "main"} onChange={(e) => update({ display: e.target.value })}>
              <option value="main">Main display</option>
              <option value="active">Display with the pointer</option>
              {monitors.length > 1 && monitors.map((m) => (
                <option key={m.name} value={m.name}>{m.label}{m.primary ? " (main)" : ""}</option>
              ))}
            </select>
          </Setting>
        )}
        {prefs.style !== "tray" && (
          <Setting label="Peek on hover" detail="Shows the running timer after a short hover. Off: click only.">
            <Toggle label="Peek on hover" checked={prefs.expandOnHover} onChange={(v) => update({ expandOnHover: v })} />
          </Setting>
        )}
        <Setting label="Show seconds" detail="1:23:45 instead of 1:23 in the running timer.">
          <Toggle label="Show seconds" checked={prefs.showSeconds} onChange={(v) => update({ showSeconds: v })} />
        </Setting>
        <Setting label="Text size" detail="The notch, its panels and the toast grow with the text.">
          <select aria-label="Text size" value={prefs.textSize} onChange={(e) => update({ textSize: e.target.value as TextSize })}>
            <option value="standard">Default</option>
            <option value="large">Large (115%)</option>
            <option value="larger">Larger (130%)</option>
          </select>
        </Setting>
        <Setting label="Appearance">
          <select aria-label="Appearance" value={prefs.appearance} onChange={(e) => update({ appearance: e.target.value as Prefs["appearance"] })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Setting>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
        When a full-screen app (a game, a video, a presentation) covers the notch's screen, the notch tucks away. Rest the pointer at the
        edge where it sits to bring it back; Ctrl+Alt+T always works.
      </p>
    </>
  );
}

// MARK: Favourites

function FavoritesSection({ prefs, update }: { prefs: Prefs; update: (p: Partial<Prefs>) => void }) {
  const favs = prefs.favorites;
  const set = (next: Favorite[]) => update({ favorites: next });
  const move = (i: number, d: number) => {
    const next = [...favs];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set(next);
  };
  return (
    <>
      <h1>Favourites</h1>
      <p className="lead">
        Save a project + task with ☆ in the entry form, or right-click an entry in the day view. In a new entry they're listed first in the
        Project dropdown; picking one fills in project and task. Stored on this PC.
      </p>
      {favs.length === 0 ? (
        <p className="muted">No favourites yet.</p>
      ) : (
        <div className="group">
          {favs.map((f, i) => (
            <div className="fav-row" key={f.id}>
              <span className="dot" style={{ background: projectColor(f.projectId) }} />
              <input
                aria-label={`Name of favourite ${i + 1}`}
                value={f.name}
                onChange={(e) => set(favs.map((x) => (x.id === f.id ? { ...x, name: e.target.value } : x)))}
              />
              <span className="muted" style={{ fontSize: 12, width: 180 }} title={`${f.projectName} · ${f.taskName}`}>
                <span className="ellipsis" style={{ display: "block" }}>{f.projectName} · {f.taskName}</span>
              </span>
              <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></button>
              <button className="icon-btn" aria-label="Move down" disabled={i === favs.length - 1} onClick={() => move(i, 1)}><ArrowDown /></button>
              <button className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => set(favs.filter((x) => x.id !== f.id))}><Trash /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// MARK: Work week

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABEL = (d: number) => new Date(2024, 0, 7 + d).toLocaleDateString(undefined, { weekday: "short" });

function DayPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  const toggle = (d: number, on: boolean) => {
    const next = on ? [...new Set([...days, d])] : days.filter((x) => x !== d);
    if (next.length) onChange(next.sort());
  };
  return (
    <div className="days">
      {DAY_ORDER.map((d) => (
        <label key={d}>
          <input type="checkbox" checked={days.includes(d)} onChange={(e) => toggle(d, e.target.checked)} />
          <span>{DAY_LABEL(d)}</span>
        </label>
      ))}
    </div>
  );
}

/** One hour field per weekday; "4:30", "4,5" or "off". */
function HoursTable({ hours, onChange }: { hours: Record<number, number>; onChange: (h: Record<number, number>) => void }) {
  const [text, setText] = useState<Record<number, string>>({});
  return (
    <div className="hours">
      {DAY_ORDER.map((d) => {
        const shown = text[d] ?? fmt.hoursLabel(hours[d] ?? 0);
        const bad = text[d] !== undefined && parseDayHours(text[d]) === null;
        return (
          <label key={d}>
            {DAY_LABEL(d)}
            <input
              className={`num ${bad ? "bad" : ""}`}
              aria-label={`Hours on ${DAY_LABEL(d)}`}
              value={shown}
              onChange={(e) => setText({ ...text, [d]: e.target.value })}
              onBlur={() => {
                const v = text[d] === undefined ? null : parseDayHours(text[d]);
                if (v !== null) onChange({ ...hours, [d]: v });
                const { [d]: _, ...rest } = text;
                setText(rest);
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

function WeekSection({ prefs, update }: { prefs: Prefs; update: (p: Partial<Prefs>) => void }) {
  const [capacity, setCapacity] = useState<number | null>(null);
  useEffect(() => {
    void loadCredentials().then((c) => new KeitoClient(c).me()).then((me) => setCapacity(me.weekly_capacity ?? null)).catch(() => undefined);
  }, []);
  const parityNow = weekNumber(new Date()) % 2 === 0 ? "even" : "odd";
  const weeks = prefs.alternatingWeeks
    ? [{ label: "Even weeks", key: "even" as const }, { label: "Odd weeks", key: "odd" as const }]
    : [{ label: "Every week", key: "even" as const }];
  const daily = targets.dailyTargetSeconds(prefs, capacity);
  const weekTarget = (key: "even" | "odd") => {
    if (prefs.customDayHours) return Object.values(key === "even" ? prefs.dayHours : prefs.oddWeekDayHours).reduce((a, b) => a + b, 0) * 3600;
    return daily * (key === "even" ? prefs.workdays : prefs.oddWeekWorkdays).length;
  };
  return (
    <>
      <h1>Work week</h1>
      <p className="lead">
        Days off show hatched. Your daily target is your Keito weekly capacity spread over your work days, unless you set your own hours per day.
      </p>
      <div className="group">
        <Setting label="Different days in even and odd weeks" detail={`For example 4 days one week, 5 the next. This is an ${parityNow} week.`}>
          <Toggle label="Different days in even and odd weeks" checked={prefs.alternatingWeeks} onChange={(v) => update({ alternatingWeeks: v })} />
        </Setting>
        <Setting label="Set hours per day" detail="Your own target per weekday (4:00 for a half day, 0:00 for a day off). Off: the capacity is spread evenly.">
          <Toggle
            label="Set hours per day"
            checked={prefs.customDayHours}
            onChange={(on) => update(on ? { ...targets.filledDayHours(prefs, capacity), customDayHours: true } : { customDayHours: false })}
          />
        </Setting>
      </div>
      {weeks.map((w) => (
        <div className="group" key={w.key}>
          <Setting label={w.label} detail={`Week target ${fmt.short(weekTarget(w.key))}${!prefs.customDayHours ? ` · ${fmt.short(daily)} a day` : ""}`}>
            <span />
          </Setting>
          <div style={{ paddingBottom: 14 }}>
            {prefs.customDayHours ? (
              <HoursTable
                hours={w.key === "even" ? prefs.dayHours : prefs.oddWeekDayHours}
                onChange={(h) => update(w.key === "even" ? { dayHours: h } : { oddWeekDayHours: h })}
              />
            ) : (
              <DayPicker
                days={w.key === "even" ? prefs.workdays : prefs.oddWeekWorkdays}
                onChange={(d) => update(w.key === "even" ? { workdays: d } : { oddWeekWorkdays: d })}
              />
            )}
          </div>
        </div>
      ))}
      {!capacity && <p className="muted" style={{ fontSize: 12 }}>No weekly capacity set in Keito: 8:00 per work day.</p>}
    </>
  );
}

// MARK: General

function GeneralSection({ prefs, update }: { prefs: Prefs; update: (p: Partial<Prefs>) => void }) {
  const [autostart, setAutostart] = useState(false);
  const [version, setVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<Status>(null);
  const [available, setAvailable] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void autostartEnabled().then(setAutostart).catch(() => undefined);
    void getVersion().then(setVersion).catch(() => undefined);
  }, []);
  const setLogin = async (on: boolean) => {
    try {
      if (on) await enableAutostart();
      else await disableAutostart();
      setAutostart(await autostartEnabled());
    } catch {
      setAutostart(!on);
    }
  };
  const checkNow = async () => {
    setBusy(true);
    setUpdateStatus(null);
    try {
      const u = await checkForUpdate();
      setAvailable(u);
      setUpdateStatus(u ? { ok: true, text: `Version ${u.version} is available.` } : { ok: true, text: "You're up to date." });
    } catch {
      setUpdateStatus({ ok: false, text: "Couldn't check for updates. Are you online?" });
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    if (!available) return;
    setBusy(true);
    setUpdateStatus({ ok: true, text: "Downloading… Keito Notch restarts when it's done." });
    try {
      await installUpdate(available);
    } catch {
      setUpdateStatus({ ok: false, text: "The update couldn't be installed. Try again later." });
      setBusy(false);
    }
  };
  return (
    <>
      <h1>General</h1>
      <div className="group">
        <Setting label="Start when I sign in to Windows">
          <Toggle label="Start when I sign in to Windows" checked={autostart} onChange={(v) => void setLogin(v)} />
        </Setting>
        <Setting label="Idle reminder" detail="After 10 minutes without input while a timer runs, ask whether to keep, remove or stop at the time you left.">
          <Toggle label="Idle reminder" checked={prefs.idleReminder} onChange={(v) => update({ idleReminder: v })} />
        </Setting>
      </div>
      <div className="group">
        <Setting label="Check for updates automatically" detail="Once a day.">
          <Toggle label="Check for updates automatically" checked={prefs.autoUpdateCheck} onChange={(v) => update({ autoUpdateCheck: v })} />
        </Setting>
        <Setting label="Install updates automatically" detail="Off: a message offers to install a new version.">
          <Toggle label="Install updates automatically" checked={prefs.autoInstall} onChange={(v) => update({ autoInstall: v })} />
        </Setting>
      </div>
      <div className="actions">
        {available ? (
          <button className="pill primary" disabled={busy} onClick={() => void install()}><UpdateIcon /> Install {available.version}</button>
        ) : (
          <button className="pill outline" disabled={busy} onClick={() => void checkNow()}>{busy ? "Checking…" : "Check for updates"}</button>
        )}
        <StatusLine status={updateStatus} />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>Keito Notch for Windows {version}</p>
    </>
  );
}
