// Commands from outside the app (Claude via scripts/keito.ps1; Rust side: src-tauri/src/remote.rs).
// Everything here is plain logic over a store-shaped object, so it's tested without Tauri (remote.test.ts);
// remoteBridge.ts connects it to the real store and the Rust queue.
import type { AppStore, EntryInput } from "./store";
import type { JiraIssue, Project, TaskItem, TimeEntry } from "./models";
import { keyFromLink, looksLikeKey } from "./jira";
import { addDays, dayKey, fromKey } from "./dates";

export type Verb = "status" | "start" | "log" | "stop";
const VERBS: Verb[] = ["status", "start", "log", "stop"];

export interface RemoteRequest {
  id: string;
  verb: Verb;
  /** Jira key or link. */
  ticket?: string;
  /** "30m", "1h", "1h30", "1.5h", "1:30". */
  duration?: string;
  /** YYYY-MM-DD, "today" or "yesterday". */
  date?: string;
  notes?: string;
  /** Project / task by name, when the ticket rules don't know (or you want another). */
  project?: string;
  task?: string;
}

export interface RemoteReply {
  id: string;
  ok: boolean;
  message: string;
  [extra: string]: unknown;
}

/** What the commands need from the store; the real AppStore has all of it. */
export type RemoteStore = Pick<
  AppStore,
  | "user"
  | "lastError"
  | "running"
  | "elapsed"
  | "today"
  | "todaySeconds"
  | "projects"
  | "requireNotes"
  | "projectName"
  | "clientName"
  | "refreshRunning"
  | "ensureTicketHistory"
  | "ticketSuggestion"
  | "organizationTask"
  | "ticketIssue"
  | "tasksFor"
  | "submit"
  | "stopRunning"
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TEXT = 2000;

export type Decoded = { ok: true; request: RemoteRequest } | { ok: false; id: string | null; error: string };

/** base64url(UTF-8 JSON) from the command line → a checked request. Without a valid id nobody can be answered. */
export function decodeRequest(b64: string): Decoded {
  let raw: unknown;
  try {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return { ok: false, id: null, error: "unreadable request" };
  }
  if (!raw || typeof raw !== "object") return { ok: false, id: null, error: "unreadable request" };
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && UUID.test(r.id) ? r.id : null;
  if (!id) return { ok: false, id: null, error: "missing or invalid id" };
  if (!VERBS.includes(r.verb as Verb)) return { ok: false, id, error: `unknown command "${String(r.verb)}" (status, start, log, stop)` };
  const request: RemoteRequest = { id, verb: r.verb as Verb };
  for (const k of ["ticket", "duration", "date", "notes", "project", "task"] as const) {
    const v = r[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" || v.length > MAX_TEXT) return { ok: false, id, error: `invalid ${k}` };
    request[k] = v.trim();
  }
  return { ok: true, request };
}

/** "30m" → 0.5, "1h" → 1, "1h30" → 1.5, "1.5h"/"1,5h" → 1.5, "1:30" → 1.5. A bare number is ambiguous: null. */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, "");
  let m: RegExpExecArray | null;
  let hours: number | null = null;
  if ((m = /^(\d+)(?:m|min|mins|minutes?)$/.exec(t))) hours = +m[1] / 60;
  else if ((m = /^(\d+(?:[.,]\d+)?)(?:h|u|hours?|uur)$/.exec(t))) hours = +m[1].replace(",", ".");
  else if ((m = /^(\d+)(?:h|u)(\d{1,2})(?:m|min)?$/.exec(t)) && +m[2] < 60) hours = +m[1] + +m[2] / 60;
  else if ((m = /^(\d+):([0-5]\d)$/.exec(t))) hours = +m[1] + +m[2] / 60;
  return hours !== null && hours > 0 && hours <= 24 ? hours : null;
}

/** YYYY-MM-DD (a real calendar day: no 2026-02-30), "today" or "yesterday". */
export function parseDate(s: string | undefined, now = new Date()): Date | null {
  const t = (s ?? "today").trim().toLowerCase();
  if (t === "today" || t === "vandaag") return fromKey(dayKey(now));
  if (t === "yesterday" || t === "gisteren") return fromKey(dayKey(addDays(now, -1)));
  const d = fromKey(t);
  return d && dayKey(d) === t ? d : null;
}

/** The ticket key in a key or a Jira link, upper case; null when it's neither. */
export function ticketKey(s: string): string | null {
  return looksLikeKey(s) ? s.toUpperCase() : keyFromLink(s);
}

type Pick1<T> = { item: T } | { error: string };

/** One item by name: exact (ignoring case) first, then the only one containing every word. */
export function pickByName<T>(items: T[], query: string, label: (t: T) => string, what: string): Pick1<T> {
  const q = query.trim().toLowerCase();
  const exact = items.filter((t) => label(t).toLowerCase() === q);
  if (exact.length === 1) return { item: exact[0] };
  const words = q.split(/\s+/).filter(Boolean);
  const hits = items.filter((t) => words.every((w) => label(t).toLowerCase().includes(w)));
  if (hits.length === 1) return { item: hits[0] };
  const shown = (hits.length ? hits : items).slice(0, 10).map(label);
  return {
    error: hits.length
      ? `More than one ${what} matches "${query}": ${shown.join(", ")}${hits.length > 10 ? ", …" : ""}`
      : `No ${what} matches "${query}"`,
  };
}

const projectLabel = (p: Project) => (p.client?.name ? `${p.client.name} ${p.name}` : p.name);

interface Booking {
  project: Project;
  task: TaskItem;
  issue: JiraIssue | null;
  notes: string;
  reason: string | null;
}

/** Project, task and notes for start/log, by the same rules as the form. Refuses rather than guesses. */
export async function resolveBooking(req: RemoteRequest, s: RemoteStore): Promise<Booking | { error: string }> {
  const key = req.ticket ? ticketKey(req.ticket) : null;
  if (req.ticket && !key) return { error: `"${req.ticket}" is not a Jira ticket key or link` };

  let project: Project;
  let task: TaskItem | undefined;
  let reason: string | null = null;
  if (req.project) {
    const p = pickByName(s.projects, req.project, projectLabel, "project");
    if ("error" in p) return p;
    project = p.item;
  } else if (key) {
    await s.ensureTicketHistory();
    const sug = s.ticketSuggestion(key);
    if (!sug) return { error: `No project known for ${key} yet: book it once in the app, or pass --project and --task` };
    project = sug.project;
    task = sug.task;
    reason = sug.reason;
    if (!task && sug.customerTask && !req.task) task = (await s.organizationTask(key, project)).task;
  } else {
    return { error: "Give a ticket, or --project and --task" };
  }

  const tasks = await s.tasksFor(project);
  if (req.task) {
    const t = pickByName(tasks, req.task, (x) => x.name, `task on ${project.name}`);
    if ("error" in t) return t;
    task = t.item;
  } else if (task) {
    task = tasks.find((x) => x.id === task!.id) ?? task;
  } else if (tasks.length === 1) {
    task = tasks[0];
  } else {
    const names = tasks.slice(0, 10).map((x) => x.name);
    return { error: `Which task on ${project.name}? Pass --task${names.length ? `. Options: ${names.join(", ")}${tasks.length > 10 ? ", …" : ""}` : ""}` };
  }

  const issue = key ? (await s.ticketIssue(key)) ?? { key, summary: "" } : null;
  const notes = req.notes ?? issue?.summary ?? "";
  if (s.requireNotes && !notes.trim()) return { error: "Keito requires notes for this entry: pass --notes" };
  return { project, task, issue, notes, reason };
}

const minutes = (seconds: number) => Math.round(seconds / 60);

function describe(e: TimeEntry, s: RemoteStore, running: boolean) {
  return {
    ticket: e.external_reference?.id ?? null,
    project: s.projectName(e),
    client: s.clientName(e) ?? null,
    task: e.task?.name ?? null,
    notes: e.notes ?? null,
    minutes: running ? minutes(s.elapsed) : minutes((e.hours ?? 0) * 3600),
    running,
  };
}

const where = (b: Booking) => `${b.issue ? `${b.issue.key} · ` : ""}${b.project.name} / ${b.task.name}`;

/** Runs one command against the store; never throws. */
export async function runRemote(req: RemoteRequest, s: RemoteStore, now = new Date()): Promise<RemoteReply> {
  const fail = (message: string): RemoteReply => ({ id: req.id, ok: false, message });
  try {
    if (!s.user) return fail(s.lastError ? `Keito isn't loaded: ${s.lastError}` : "Keito isn't connected: open Keito Notch Settings");
    switch (req.verb) {
      case "status": {
        await s.refreshRunning();
        const r = s.running;
        return {
          id: req.id,
          ok: true,
          message: r ? `Running: ${s.projectName(r)} · ${minutes(s.elapsed)} min` : "No timer running",
          running: r ? describe(r, s, true) : null,
          today: {
            minutes: minutes(s.todaySeconds),
            entries: s.today.map((e) => describe(e, s, e.id === r?.id)),
          },
        };
      }
      case "stop": {
        await s.refreshRunning();
        const r = s.running;
        if (!r) return fail("No timer running");
        const label = `${s.projectName(r)} at ${minutes(s.elapsed)} min`;
        if (!(await s.stopRunning())) return fail(s.lastError ?? "Keito didn't stop the timer");
        return { id: req.id, ok: true, message: `Stopped ${label} (Undo in the notch)` };
      }
      case "start":
      case "log": {
        let hours: number | null = null;
        if (req.verb === "log") {
          if (!req.duration) return fail("How long? e.g. 30m, 1h, 1h30");
          hours = parseDuration(req.duration);
          if (hours === null) return fail(`"${req.duration}" is not a duration: use e.g. 30m, 1h, 1h30, 1.5h`);
        }
        const date = req.verb === "log" ? parseDate(req.date, now) : parseDate("today", now);
        if (!date) return fail(`"${req.date}" is not a date: use YYYY-MM-DD, today or yesterday`);
        const b = await resolveBooking(req, s);
        if ("error" in b) return fail(b.error);
        const input: EntryInput = {
          project: b.project,
          task: b.task,
          date,
          timing: hours === null ? { kind: "timer" } : { kind: "duration", hours },
          billable: b.task.billable ?? b.project.is_billable ?? true,
          jira: b.issue,
          existingRef: null,
          notes: b.notes,
          editing: null,
        };
        if (!(await s.submit(input))) return fail(s.lastError ?? "Keito refused the entry");
        const what = hours === null ? "Timer started on" : `Logged ${Math.round(hours * 60)} min on`;
        return {
          id: req.id,
          ok: true,
          message: `${what} ${where(b)}${hours === null ? "" : ` (${dayKey(date)})`}. Undo in the notch.`,
          project: b.project.name,
          task: b.task.name,
          ticket: b.issue?.key ?? null,
          reason: b.reason,
        };
      }
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
