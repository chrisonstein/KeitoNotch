// Keito REST API v2 — port of KeitoClient.swift. Docs: https://keito.ai/docs/api-reference/overview/
import { http } from "./native";
import { hasKeito, type Credentials } from "./prefs";
import {
  normaliseIds,
  type CurrentUser,
  type ID,
  type NewTimeEntry,
  type Project,
  type TaskItem,
  type TimeEntry,
  type TimeEntryUpdate,
} from "./models";

export class APIError extends Error {
  constructor(public status: number, public body: string, message?: string) {
    super(message ?? `HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

/**
 * The server's own reason from an error body, or null. Keito sends `{ error, error_description }`
 * (https://keito.ai/docs/api-reference/error-handling); some endpoints use `message`; Jira sends
 * `{ errorMessages: [...], errors: { field: text } }`.
 */
export function serverReason(body: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const fieldErrors = o.errors && typeof o.errors === "object" && !Array.isArray(o.errors) ? Object.values(o.errors) : [];
  const listErrors = Array.isArray(o.errors) ? o.errors : [];
  const reason =
    text(o.error_description) ??
    text(o.message) ??
    (Array.isArray(o.errorMessages) ? o.errorMessages.map(text).find(Boolean) : null) ??
    fieldErrors.map(text).find(Boolean) ??
    listErrors.map((x) => text(x) ?? text((x as { message?: unknown })?.message)).find(Boolean) ??
    null;
  return reason ? reason.slice(0, 200) : null;
}

/** Plain-words messages for the usual setup mistakes; otherwise the server's own reason. */
export function friendlyError(e: unknown): string {
  if (e instanceof APIError) {
    switch (e.status) {
      case 401: return "The key or token was rejected (401). Check that you copied it completely.";
      case 403: return "Access denied (403). For Keito, use a key with All permitted operations and the right Company ID.";
      case 404: return "Not found (404). Check the Company ID or Jira site.";
    }
    // A message we wrote ourselves (e.g. the running-timer conflict) wins over the raw body.
    if (!e.message.startsWith("HTTP ")) return e.message;
    const reason = serverReason(e.body);
    return reason ? `${reason} (${e.status})` : `The server answered with error ${e.status}.`;
  }
  if (e instanceof Error) {
    if (/network|fetch|dns|connect/i.test(e.message)) return "You're offline or the site didn't answer.";
    return e.message;
  }
  return String(e);
}

const BASE = "https://app.keito.ai/api/v2/";

interface ProjectAssignment {
  project: { id: ID; name: string; code?: string; is_billable?: boolean };
  client?: { id: ID; name?: string } | null;
  can_track_time?: boolean;
  task_assignments: { is_active?: boolean; billable?: boolean; task: { id: ID; name?: string } }[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export class KeitoClient {
  constructor(private creds: Credentials) {}

  private async request(method: string, path: string, query: Record<string, string> = {}, body?: unknown): Promise<unknown> {
    if (!hasKeito(this.creds)) throw new Error("Keito is not configured. Open Settings.");
    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.creds.keitoApiKey}`,
      "Keito-Account-Id": this.creds.keitoAccountId,
      Accept: "application/json",
      "User-Agent": "KeitoNotch-Windows/0.1",
    };
    // Writes are safe to retry: the server replays the first result for 24 h.
    if (method !== "GET") headers["Idempotency-Key"] = crypto.randomUUID();
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const resp = await http(url.toString(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await resp.text();
    if (resp.status === 409 && text.includes("running_timer_conflict")) {
      throw new APIError(409, text, "Another timer is already running.");
    }
    if (!resp.ok) throw new APIError(resp.status, text);
    return text ? normaliseIds(JSON.parse(text)) : null;
  }

  private get<T>(path: string, query: Record<string, string> = {}) {
    return this.request("GET", path, query) as Promise<T>;
  }

  me() {
    return this.get<CurrentUser>("users/me");
  }

  /** Projects with their trackable tasks in one call; falls back to /projects (tasks loaded lazily). */
  async trackableProjects(): Promise<Project[]> {
    let all: Project[] = [];
    try {
      for (let page = 1; ; page++) {
        const p = await this.get<{ project_assignments: ProjectAssignment[]; total_pages?: number }>(
          "users/me/project_assignments", { per_page: "500", page: String(page) });
        all.push(...p.project_assignments.filter((a) => a.can_track_time ?? true).map((a) => ({
          id: a.project.id,
          name: a.project.name,
          code: a.project.code,
          client: a.client,
          is_billable: a.project.is_billable,
          tasks: a.task_assignments
            .filter((t) => t.is_active ?? true)
            .map((t) => ({ id: t.task.id, name: t.task.name ?? "Task", billable: t.billable }))
            .sort(byName),
        })));
        if (!p.total_pages || page >= p.total_pages) break;
      }
    } catch {
      all = await this.activeProjects();
    }
    return all.sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" }));
  }

  async activeProjects(): Promise<Project[]> {
    const all: Project[] = [];
    for (let page = 1; ; page++) {
      const p = await this.get<{ projects: Project[]; total_pages?: number }>(
        "projects", { is_active: "true", per_page: "500", page: String(page) });
      all.push(...p.projects);
      if (!p.total_pages || page >= p.total_pages) break;
    }
    return all;
  }

  async tasks(projectId: ID): Promise<TaskItem[]> {
    try {
      const p = await this.get<{ task_assignments: ProjectAssignment["task_assignments"] }>(
        `projects/${projectId}/task_assignments`, { is_active: "true", per_page: "500" });
      return p.task_assignments
        .filter((t) => t.is_active ?? true)
        .map((t) => ({ id: t.task.id, name: t.task.name ?? "Task", billable: t.billable }));
    } catch {
      const p = await this.get<{ tasks: TaskItem[] }>("tasks", { project_id: projectId, is_active: "true", per_page: "500" });
      return p.tasks;
    }
  }

  async runningEntry(userId?: ID): Promise<TimeEntry | null> {
    const q: Record<string, string> = { is_running: "true", per_page: "1", include: "client" };
    if (userId) q.user_id = userId;
    return (await this.get<{ time_entries: TimeEntry[] }>("time_entries", q)).time_entries[0] ?? null;
  }

  /** Most recently touched entries first. */
  async recentEntries(userId?: ID, limit = 30): Promise<TimeEntry[]> {
    const q: Record<string, string> = { per_page: String(limit), include: "client" };
    if (userId) q.user_id = userId;
    try {
      return (await this.get<{ time_entries: TimeEntry[] }>("time_entries", { ...q, sort_by: "updated_at" })).time_entries;
    } catch {
      return (await this.get<{ time_entries: TimeEntry[] }>("time_entries", q)).time_entries;
    }
  }

  /** Entries with spent_date in from…to (inclusive). include=client caps a page at 200. */
  async entries(userId: ID | undefined, from: string, to: string, includeClient = false): Promise<TimeEntry[]> {
    const q: Record<string, string> = { from, to, per_page: includeClient ? "200" : "1000" };
    if (includeClient) q.include = "client";
    if (userId) q.user_id = userId;
    return (await this.get<{ time_entries: TimeEntry[] }>("time_entries", q)).time_entries;
  }

  create(entry: NewTimeEntry) {
    return this.request("POST", "time_entries", {}, entry) as Promise<TimeEntry>;
  }

  async stop(id: ID, stoppedAt?: Date) {
    await this.request("PATCH", `time_entries/${id}/stop`, {}, stoppedAt ? { stopped_at: iso(stoppedAt) } : {});
  }

  async restart(id: ID) {
    await this.request("PATCH", `time_entries/${id}/restart`, {}, { replace_running: true });
  }

  async update(id: ID, entry: TimeEntryUpdate) {
    await this.request("PATCH", `time_entries/${id}`, {}, entry);
  }

  async delete(id: ID) {
    await this.request("DELETE", `time_entries/${id}`);
  }

  /** Removes an idle period from the running timer; no resumedAt = stop at the idle start. */
  async removeIdle(id: ID, idleStart: Date, resumedAt: Date | null, timerStartedAt: string) {
    const body: Record<string, string> = {
      action: resumedAt ? "continue_and_remove" : "stop_and_remove",
      inactive_started_at: iso(idleStart),
      expected_timer_started_at: timerStartedAt,
    };
    if (resumedAt) body.resumed_at = iso(resumedAt);
    await this.request("PATCH", `time_entries/${id}/adjust_running_timer`, {}, body);
  }
}

/** ISO 8601 without milliseconds, like the Mac app. */
function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function displayName(p: Project): string {
  return p.client?.name ? `${p.client.name} · ${p.name}` : p.name;
}
