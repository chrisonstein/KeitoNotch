// Wire types for Keito API v2 (Harvest-compatible). Keito IDs are strings, Harvest-style ints: we normalise to string.

export type ID = string;

export interface NamedRef {
  id: ID;
  name?: string | null;
}

export interface TaskItem {
  id: ID;
  name: string;
  /** Per-task billable default; undefined without project-financial visibility. */
  billable?: boolean | null;
}

export interface Project {
  id: ID;
  name: string;
  code?: string | null;
  client?: NamedRef | null;
  is_billable?: boolean | null;
  /** Filled when loaded from users/me/project_assignments. */
  tasks?: TaskItem[];
}

export interface ExternalReference {
  id: string;
  permalink?: string | null;
  service?: string | null;
  service_name?: string | null;
  display_name?: string | null;
}

export interface TimeEntry {
  id: ID;
  spent_date?: string | null;
  hours?: number | null;
  /** Saved seconds before the current run. */
  duration_seconds?: number | null;
  notes?: string | null;
  is_running?: boolean | null;
  timer_started_at?: string | null;
  billable?: boolean | null;
  is_locked?: boolean | null;
  project?: NamedRef | null;
  task?: NamedRef | null;
  client?: NamedRef | null;
  project_id?: ID | null;
  task_id?: ID | null;
  external_reference?: ExternalReference | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CompanyPolicy {
  name?: string;
  timezone?: string;
  week_start_day?: string;
  require_notes?: boolean;
  time_billability_overrides_enabled?: boolean;
}

export interface CurrentUser {
  id: ID;
  first_name?: string;
  last_name?: string;
  /** Seconds per week. */
  weekly_capacity?: number | null;
  company?: CompanyPolicy | null;
  capabilities?: { can_track_time?: boolean; can_edit_time_billability?: boolean } | null;
}

export interface NewTimeEntry {
  project_id: string;
  task_id: string;
  spent_date: string;
  hours?: number;
  is_running?: boolean;
  replace_running?: boolean;
  billable?: boolean;
  notes?: string;
  source: "desktop";
  external_reference?: ExternalReference | null;
  metadata?: Record<string, string>;
}

export interface TimeEntryUpdate {
  project_id: string;
  task_id: string;
  spent_date: string;
  hours?: number;
  billable?: boolean;
  /** null clears */
  notes: string | null;
  /** null removes */
  external_reference: ExternalReference | null;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status?: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  details: string;
  start: Date;
  end: Date;
  link?: string;
}

export interface CalendarInfo {
  id: string;
  title: string;
  colorHex?: string;
  isPrimary: boolean;
}

/** Normalise int-or-string IDs anywhere in a parsed JSON value. */
export function normaliseIds<T>(v: T): T {
  if (Array.isArray(v)) return v.map(normaliseIds) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = (k === "id" || k.endsWith("_id")) && typeof val === "number" ? String(val) : normaliseIds(val);
    }
    return out as T;
  }
  return v;
}

export const projectIdOf = (e: TimeEntry): ID | undefined => e.project_id ?? e.project?.id ?? undefined;
export const taskIdOf = (e: TimeEntry): ID | undefined => e.task_id ?? e.task?.id ?? undefined;

/** Calendar event this entry was logged from. */
export function calendarEventIdOf(e: TimeEntry): string | undefined {
  const m = e.metadata;
  if (!m || typeof m !== "object") return undefined;
  const v = m["calendar_event_id"] ?? m["google_calendar_event_id"];
  return typeof v === "string" ? v : undefined;
}
