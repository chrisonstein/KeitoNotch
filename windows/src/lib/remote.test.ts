import { describe, expect, it } from "vitest";
import { decodeRequest, parseDate, parseDuration, runRemote, type RemoteRequest, type RemoteStore } from "./remote";
import type { EntryInput } from "./store";
import type { Project, TaskItem, TimeEntry } from "./models";
import type { TicketSuggestion } from "./ticketRules";

const ID = "3f2a9c1e-0b4d-4e8f-9a6b-1c2d3e4f5a6b";
const b64 = (o: unknown) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("decodeRequest", () => {
  it("reads base64url JSON, also with non-ASCII notes", () => {
    const d = decodeRequest(b64({ id: ID, verb: "log", ticket: "CSD-1", duration: "30m", notes: "Één printer – kapot" }));
    expect(d).toEqual({ ok: true, request: { id: ID, verb: "log", ticket: "CSD-1", duration: "30m", notes: "Één printer – kapot" } });
  });
  it("no valid id → nobody to answer", () => {
    expect(decodeRequest("%%%")).toMatchObject({ ok: false, id: null });
    expect(decodeRequest(b64({ id: "nul", verb: "status" }))).toMatchObject({ ok: false, id: null });
    expect(decodeRequest(b64({ id: "../x", verb: "status" }))).toMatchObject({ ok: false, id: null });
  });
  it("valid id but a bad command or field → answered with the reason", () => {
    expect(decodeRequest(b64({ id: ID, verb: "delete" }))).toMatchObject({ ok: false, id: ID });
    expect(decodeRequest(b64({ id: ID, verb: "log", notes: 5 }))).toMatchObject({ ok: false, id: ID, error: "invalid notes" });
  });
});

describe("parseDuration", () => {
  it.each([
    ["30m", 0.5], ["45 min", 0.75], ["1h", 1], ["1,5h", 1.5], ["1.5 uur", 1.5], ["1h30", 1.5], ["2u15m", 2.25], ["1:30", 1.5],
  ])("%s → %s h", (s, h) => expect(parseDuration(s)).toBeCloseTo(h as number));
  it.each(["90", "", "0m", "25h", "1h75", "abc", "-1h"])("%s → refused", (s) => expect(parseDuration(s)).toBeNull());
});

describe("parseDate", () => {
  const now = new Date(2026, 10, 26, 14, 0);
  it("today, yesterday and real calendar days", () => {
    expect(parseDate(undefined, now)).toEqual(new Date(2026, 10, 26));
    expect(parseDate("yesterday", now)).toEqual(new Date(2026, 10, 25));
    expect(parseDate("2026-11-02", now)).toEqual(new Date(2026, 10, 2));
  });
  it("no rolling over: 2026-02-30 is not 2 March", () => {
    expect(parseDate("2026-02-30", now)).toBeNull();
    expect(parseDate("26-11-2026", now)).toBeNull();
  });
});

// MARK: runRemote against a fake store

const serviceDesk: Project = { id: "sd", name: "Service Desk", client: { id: "c", name: "Customer support" }, is_billable: true };
const rollout: Project = { id: "ro", name: "Rollout", client: { id: "a", name: "Acme" } };
const sdTasks: TaskItem[] = [{ id: "t-acme", name: "Acme" }, { id: "t-globex", name: "Globex" }];
const roTasks: TaskItem[] = [{ id: "t-dev", name: "Development", billable: false }];

function fakeStore(over: Partial<RemoteStore> & { suggestions?: Record<string, TicketSuggestion>; orgTask?: TaskItem } = {}) {
  const submitted: EntryInput[] = [];
  let stops = 0;
  const s = {
    user: { id: "u" },
    lastError: null,
    running: null as TimeEntry | null,
    elapsed: 0,
    today: [] as TimeEntry[],
    todaySeconds: 0,
    projects: [serviceDesk, rollout],
    requireNotes: false,
    projectName: (e: TimeEntry) => e.project?.name ?? "?",
    clientName: (e: TimeEntry) => e.client?.name,
    refreshRunning: async () => undefined,
    ensureTicketHistory: async () => undefined,
    ticketSuggestion: (key: string) => over.suggestions?.[key],
    organizationTask: async () => ({ task: over.orgTask, orgs: over.orgTask ? ["Customer"] : [], candidates: [], remembered: false }),
    ticketIssue: async (key: string) => ({ key, summary: `Title of ${key}` }),
    tasksFor: async (p: Project) => (p.id === "sd" ? sdTasks : roTasks),
    submit: async (i: EntryInput) => {
      submitted.push(i);
      return true;
    },
    stopRunning: async () => {
      stops++;
      return true;
    },
    ...over,
  } as unknown as RemoteStore;
  return { s, submitted, stops: () => stops };
}

const req = (r: Omit<RemoteRequest, "id">): RemoteRequest => ({ id: ID, ...r });
const now = new Date(2026, 10, 26, 14, 0);

describe("runRemote: start and log follow the ticket rules", () => {
  it("CSD → Service Desk with the customer from Jira, the ticket attached, its title as notes", async () => {
    const { s, submitted } = fakeStore({
      suggestions: { "CSD-7": { project: serviceDesk, fixed: true, customerTask: true, reason: "CSD → Service Desk" } },
      orgTask: sdTasks[1],
    });
    const r = await runRemote(req({ verb: "start", ticket: "csd-7" }), s, now);
    expect(r.ok).toBe(true);
    expect(submitted[0]).toMatchObject({
      project: { id: "sd" }, task: { id: "t-globex" }, timing: { kind: "timer" }, jira: { key: "CSD-7" }, notes: "Title of CSD-7",
    });
  });

  it("log: duration and date, billable from the task", async () => {
    const { s, submitted } = fakeStore({
      suggestions: { "ABC-12": { project: rollout, fixed: false, customerTask: false, reason: "Like earlier ABC tickets" } },
    });
    const r = await runRemote(req({ verb: "log", ticket: "ABC-12", duration: "1h30", date: "yesterday", notes: "Review" }), s, now);
    expect(r).toMatchObject({ ok: true, project: "Rollout", task: "Development", ticket: "ABC-12" });
    expect(submitted[0]).toMatchObject({ timing: { kind: "duration", hours: 1.5 }, date: new Date(2026, 10, 25), billable: false, notes: "Review" });
  });

  it("a CSD ticket whose customer isn't clear is refused, with the options", async () => {
    const { s, submitted } = fakeStore({ suggestions: { "CSD-8": { project: serviceDesk, fixed: true, customerTask: true, reason: "CSD → Service Desk" } } });
    const r = await runRemote(req({ verb: "start", ticket: "CSD-8" }), s, now);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Which task on Service Desk\? Pass -Task\. Options: Acme, Globex/);
    expect(submitted).toHaveLength(0);
  });

  it("an unknown ticket is refused, never guessed", async () => {
    const { s, submitted } = fakeStore();
    const r = await runRemote(req({ verb: "log", ticket: "XYZ-1", duration: "30m" }), s, now);
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/No project known for XYZ-1/) });
    expect(submitted).toHaveLength(0);
  });

  it("-Project and -Task by name win over the rules", async () => {
    const { s, submitted } = fakeStore();
    const r = await runRemote(req({ verb: "log", ticket: "XYZ-1", duration: "15m", project: "acme rollout", task: "dev" }), s, now);
    expect(r.ok).toBe(true);
    expect(submitted[0]).toMatchObject({ project: { id: "ro" }, task: { id: "t-dev" } });
  });

  it("bad input is refused before anything is booked", async () => {
    const { s, submitted } = fakeStore();
    expect((await runRemote(req({ verb: "log", ticket: "ABC-1" }), s, now)).ok).toBe(false);
    expect((await runRemote(req({ verb: "log", ticket: "ABC-1", duration: "90" }), s, now)).ok).toBe(false);
    expect((await runRemote(req({ verb: "log", ticket: "ABC-1", duration: "1h", date: "2026-02-30" }), s, now)).ok).toBe(false);
    expect((await runRemote(req({ verb: "start", ticket: "not a ticket" }), s, now)).ok).toBe(false);
    expect(submitted).toHaveLength(0);
  });

  it("required notes: the ticket title counts, nothing at all is refused", async () => {
    const { s } = fakeStore({ requireNotes: true, ticketIssue: async () => null });
    const r = await runRemote(req({ verb: "log", duration: "1h", project: "Rollout" }), s, now);
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/requires notes/) });
  });

  it("Keito refusing the entry is a failure with Keito's reason", async () => {
    const { s } = fakeStore({ submit: async () => false, lastError: "Project is archived" } as Partial<RemoteStore>);
    const r = await runRemote(req({ verb: "log", duration: "1h", project: "Rollout" }), s, now);
    expect(r).toEqual({ id: ID, ok: false, message: "Project is archived" });
  });
});

describe("runRemote: status and stop", () => {
  const running: TimeEntry = {
    id: "e1", spent_date: "2026-11-26", is_running: true, project: { id: "sd", name: "Service Desk" },
    task: { id: "t-acme", name: "Acme" }, external_reference: { id: "CSD-7" },
  };
  it("status: the running timer and today's entries in minutes", async () => {
    const done: TimeEntry = { id: "e0", hours: 0.5, project: { id: "ro", name: "Rollout" }, task: { id: "t-dev", name: "Development" } };
    const { s } = fakeStore({ running, elapsed: 1500, today: [done, running], todaySeconds: 3300 });
    const r = await runRemote(req({ verb: "status" }), s, now);
    expect(r).toMatchObject({
      ok: true,
      running: { ticket: "CSD-7", project: "Service Desk", task: "Acme", minutes: 25, running: true },
      today: { minutes: 55, entries: [{ project: "Rollout", minutes: 30, running: false }, { ticket: "CSD-7", running: true }] },
    });
  });
  it("stop: only a real stop is ok", async () => {
    const a = fakeStore({ running, elapsed: 600 });
    expect(await runRemote(req({ verb: "stop" }), a.s, now)).toMatchObject({ ok: true, message: expect.stringMatching(/Stopped Service Desk at 10 min/) });
    const b = fakeStore();
    expect(await runRemote(req({ verb: "stop" }), b.s, now)).toMatchObject({ ok: false, message: "No timer running" });
    expect(b.stops()).toBe(0);
    const c = fakeStore({ running, stopRunning: async () => false, lastError: "Keito is down" } as Partial<RemoteStore>);
    expect(await runRemote(req({ verb: "stop" }), c.s, now)).toMatchObject({ ok: false, message: "Keito is down" });
  });
  it("not connected: says so instead of acting", async () => {
    const { s } = fakeStore({ user: null });
    expect(await runRemote(req({ verb: "status" }), s, now)).toMatchObject({ ok: false, message: expect.stringMatching(/isn't connected/) });
  });
});
