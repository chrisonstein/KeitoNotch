// Which Keito project (and task) a Jira ticket books on. Pure logic, no network: the form calls it
// when you pick a ticket, and once more when the ticket's Jira organisation is known.
import { projectIdOf, taskIdOf, type JiraIssue, type Project, type TaskItem, type TimeEntry } from "./models";
import type { TicketRule } from "./prefs";

const KEY = /^[A-Za-z][A-Za-z0-9_]+-\d+$/;

/**
 * Tickets you logged time on, newest first, each once: the quickest pick in the ticket field. The title comes
 * from the entry's link ("CSD-12 Printer offline" → "Printer offline"). `history` is newest first.
 */
export function recentTicketsOf(history: TimeEntry[], limit: number): JiraIssue[] {
  const out: JiraIssue[] = [];
  const seen = new Set<string>();
  for (const e of history) {
    const ref = e.external_reference;
    const key = ref?.id?.toUpperCase();
    if (!key || !KEY.test(key) || seen.has(key)) continue;
    seen.add(key);
    const name = ref?.display_name?.trim() ?? "";
    const summary = name.toUpperCase().startsWith(key) ? name.slice(key.length).replace(/^[\s:–-]+/, "") : name;
    out.push({ key, summary });
    if (out.length >= limit) break;
  }
  return out;
}

export interface TicketSuggestion {
  project: Project;
  task?: TaskItem;
  /** A ticket rule says this prefix always books here: it wins over a project you already had in the form. */
  fixed: boolean;
  /** A ticket rule applies: the task is the ticket's customer (Jira Organizations) when Jira names one. */
  customerTask: boolean;
  reason: string;
}

export const prefixOf = (key: string) => key.split("-")[0]?.toUpperCase() ?? "";

/** The rule and project for a ticket's prefix; nothing when there's no rule or its project isn't trackable (any more). */
export function fixedProject(key: string, projects: Project[], rules: TicketRule[]): { rule: TicketRule; project: Project } | undefined {
  const prefix = prefixOf(key);
  const rule = rules.find((r) => r.prefix.trim().toUpperCase() === prefix);
  const project = rule && projects.find((p) => p.id === rule.projectId);
  return rule && project ? { rule, project } : undefined;
}

/**
 * Where a ticket books, strongest first:
 * 1. this exact ticket was logged before → same project and task;
 * 2. a ticket rule from Settings → Jira (e.g. CSD → Service Desk);
 * 3. another ticket with the same prefix was logged before → that project.
 * `history` is newest first.
 */
export function suggestForTicket(key: string, projects: Project[], history: TimeEntry[], rules: TicketRule[] = []): TicketSuggestion | undefined {
  const k = key.toUpperCase();
  const prefix = prefixOf(k);
  const ruled = fixedProject(k, projects, rules);
  const fixed = ruled?.project;
  const customerTask = !!ruled;
  const refOf = (e: TimeEntry) => e.external_reference?.id?.toUpperCase() ?? "";
  const byId = (id: string | undefined) => (id ? projects.find((p) => p.id === id) : undefined);

  const same = history.find((e) => refOf(e) === k && byId(projectIdOf(e)));
  const sameProject = same && byId(projectIdOf(same));
  // A fixed prefix only takes history from that same project (an old entry on another project was a mistake).
  if (same && sameProject && (!fixed || fixed.id === sameProject.id)) {
    const tid = taskIdOf(same);
    const task = sameProject.tasks?.find((t) => t.id === tid)
      ?? (same.task && tid ? { id: tid, name: same.task.name ?? "Task" } : undefined);
    return { project: sameProject, task, fixed: !!fixed, customerTask, reason: "Logged like this before" };
  }
  if (fixed) return { project: fixed, fixed: true, customerTask, reason: `${prefix} → ${fixed.name}` };

  const sibling = history.find((e) => prefixOf(refOf(e)) === prefix && refOf(e).includes("-") && byId(projectIdOf(e)));
  const siblingProject = sibling && byId(projectIdOf(sibling));
  if (siblingProject) return { project: siblingProject, fixed: false, customerTask: false, reason: `Like earlier ${prefix} tickets` };
  return undefined;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Legal-form noise that differs between Jira and Keito ("Acme B.V." vs "Acme"). */
const NOISE = new Set(["bv", "nv", "vof", "gmbh", "ltd", "inc", "holding", "group", "groep"]);
/** "Acme B.V." → "acme": lower case, no punctuation, no legal form ("B.V." splits into "b" and "v"). */
const core = (s: string) => {
  const words = norm(s).split(" ").filter(Boolean);
  const out = words.filter((w, i) => !NOISE.has(w) && !(w.length === 1 && (words[i - 1]?.length === 1 || words[i + 1]?.length === 1)));
  return out.join(" ");
};

/**
 * The task named after the ticket's customer (in the service-desk setup the task is the customer).
 * Only a single clear match: exact name first, then one task whose name contains the organisation or the
 * other way round. A ticket with two organisations that point at different tasks is just as uncertain (the
 * first used to win, so Jira's order decided the customer). Anything less certain returns undefined, and you
 * pick the task yourself.
 */
export function taskForOrganization(orgs: string[], tasks: TaskItem[]): TaskItem | undefined {
  const found = new Map<string, TaskItem>();
  for (const org of orgs) {
    const t = taskForOne(org, tasks);
    if (t) found.set(t.id, t);
  }
  return found.size === 1 ? [...found.values()][0] : undefined;
}

function taskForOne(org: string, tasks: TaskItem[]): TaskItem | undefined {
  const o = core(org);
  if (o.length < 2) return undefined;
  const exact = tasks.filter((t) => core(t.name) === o);
  if (exact.length === 1) return exact[0];
  const loose = tasks.filter((t) => {
    const c = core(t.name);
    return c.length >= 3 && (c.includes(o) || o.includes(c));
  });
  return loose.length === 1 ? loose[0] : undefined;
}
