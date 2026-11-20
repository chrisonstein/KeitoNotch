// Guesses project, task and Jira ticket for a meeting — port of CalendarMatcher. Leaves the project empty when unsure.
import { projectIdOf, taskIdOf, type CalendarEvent, type Project, type TaskItem, type TimeEntry } from "./models";

export interface Match {
  project?: Project;
  task?: TaskItem;
  jiraKey?: string;
  /** Why the project was chosen. */
  reason?: string;
}

const KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/;
const STOP_WORDS = new Set(["project", "design", "team", "meeting", "with", "and", "the", "for", "intern", "internal", "sync"]);
const normalized = (s: string) => s.toLowerCase().trim();
const wordsOf = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function matchEvent(event: CalendarEvent, projects: Project[], history: TimeEntry[]): Match {
  const m: Match = {};
  const text = `${event.title}\n${event.details}`;
  const key = KEY.exec(text);
  const keyPrefix = key?.[1];
  if (key) m.jiraKey = key[0];

  // 1. A meeting with this title was logged before (recurring meetings): reuse project + task.
  const title = normalized(event.title);
  if (title) {
    const earlier = history.find((e) => normalized(e.notes ?? "") === title && projectIdOf(e));
    const project = earlier && projects.find((p) => p.id === projectIdOf(earlier));
    if (earlier && project) {
      m.project = project;
      m.task = project.tasks?.find((t) => t.id === taskIdOf(earlier))
        ?? (earlier.task ? { id: earlier.task.id, name: earlier.task.name ?? "Task" } : undefined);
      m.reason = "Logged like this before";
      return m;
    }
  }

  // 2. Score projects on code, Jira prefix, name and client name.
  const lower = text.toLowerCase();
  const words = new Set(wordsOf(lower));
  const scored = projects.map((p) => {
    let score = 0;
    const code = p.code?.toLowerCase();
    if (code && code.length >= 2) {
      if (words.has(code)) score += 4;
      if (keyPrefix?.toLowerCase() === code) score += 4;
    }
    const name = p.name.toLowerCase();
    if (name.length >= 3 && lower.includes(name)) score += 4;
    score += wordsOf(name).filter((w) => w.length >= 4 && !STOP_WORDS.has(w) && words.has(w)).length;
    const client = p.client?.name?.toLowerCase();
    if (client && client.length >= 3 && lower.includes(client)) score += 1;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // Confident only with a clear, unique winner.
  const [best, second] = scored;
  if (best && best.score >= 2 && (!second || second.score < best.score)) {
    m.project = best.p;
    m.reason = `Matched on “${best.p.code ?? best.p.name}”`;
  }
  return m;
}

/** A "Meeting"-like task, used when logging a meeting. */
export function meetingTask(tasks: TaskItem[]): TaskItem | undefined {
  return tasks.find((t) => ["meeting", "overleg", "call"].some((w) => t.name.toLowerCase().includes(w)));
}
