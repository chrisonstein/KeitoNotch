import { describe, expect, it, vi } from "vitest";

// The modules under test import Tauri wrappers; stub them so the pure logic runs in Node.
vi.mock("./native", () => ({ http: vi.fn(), native: {}, openExternal: vi.fn(), secrets: { get: vi.fn(), set: vi.fn() } }));

import { hoursLabel, overTargetSuffix, parseHours, short, timer, words } from "./duration";
import { keyFromLink, looksLikeKey } from "./jira";
import { matchEvent, meetingTask } from "./matcher";
import { toEvent, CalendarProblem } from "./google";
import { normaliseIds, type Project, type TimeEntry } from "./models";
import { dayKey, startOfWeek, weekNumber } from "./dates";
import { normaliseHost } from "./prefs";

describe("parseHours (same rules as the Mac app)", () => {
  it.each([
    ["1:30", 1.5],
    [":45", 0.75],
    ["1.5", 1.5],
    ["1,5", 1.5],
    ["1h30", 1.5],
    ["1h 30m", 1.5],
    ["90m", 1.5],
    ["90min", 1.5],
    ["2h", 2],
    ["45", 0.75], // bare integer > 12 = minutes
    ["24", 0.4],
    ["8", 8],
    ["0.25", 0.25],
  ])("%s → %s", (input, hours) => expect(parseHours(input)).toBe(hours));

  it.each(["", "abc", "1:75", "0", "24:00", "25:00", "1:2:3", "h", "-1"])("rejects %j", (input) => {
    expect(parseHours(input)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats clocks and labels", () => {
    expect(short(5025)).toBe("1:23");
    expect(timer(5025, true)).toBe("1:23:45");
    expect(timer(5025, false)).toBe("1:23");
    expect(hoursLabel(1.5)).toBe("1:30");
    expect(words(5400)).toBe("1h 30m");
    expect(words(0)).toBe("0m");
    expect(overTargetSuffix(9 * 3600, 8 * 3600)).toBe(" · +1:00 over");
    expect(overTargetSuffix(8 * 3600, 8 * 3600)).toBe("");
  });
});

describe("Jira", () => {
  it("recognises keys and links", () => {
    expect(looksLikeKey("MOS-2066")).toBe(true);
    expect(looksLikeKey("MOS")).toBe(false);
    expect(keyFromLink("https://acme.atlassian.net/browse/mos-12")).toBe("MOS-12");
    expect(keyFromLink("https://acme.atlassian.net/jira/software/projects/X/boards/1?selectedIssue=ABC-7")).toBe("ABC-7");
    expect(keyFromLink("not a link")).toBeNull();
  });
  it("normalises the site", () => {
    expect(normaliseHost(" https://acme.atlassian.net/ ")).toBe("acme.atlassian.net");
  });
});

describe("matchEvent", () => {
  const projects: Project[] = [
    { id: "p1", name: "Mosaic", code: "MOS", tasks: [{ id: "t1", name: "Development" }, { id: "t2", name: "Meeting" }] },
    { id: "p2", name: "Internal", code: "INT" },
  ];
  const ev = (title: string, details = "") => ({ id: "e", title, details, start: new Date(), end: new Date() });

  it("reuses an earlier entry with the same title", () => {
    const history: TimeEntry[] = [{ id: "x", notes: "Weekly sync", project_id: "p1", task_id: "t2" }];
    const m = matchEvent(ev("Weekly sync"), projects, history);
    expect(m.project?.id).toBe("p1");
    expect(m.task?.id).toBe("t2");
  });

  it("matches on a Jira key prefix and keeps the key", () => {
    const m = matchEvent(ev("MOS-2066 review"), projects, []);
    expect(m.project?.id).toBe("p1");
    expect(m.jiraKey).toBe("MOS-2066");
  });

  it("leaves the project empty when unsure", () => {
    expect(matchEvent(ev("Lunch"), projects, []).project).toBeUndefined();
  });

  it("finds a meeting task", () => {
    expect(meetingTask(projects[0].tasks!)?.id).toBe("t2");
  });
});

describe("Google events", () => {
  it("skips all-day, cancelled, declined and out-of-office events", () => {
    const timed = { start: { dateTime: "2026-11-20T09:00:00Z" }, end: { dateTime: "2026-11-20T10:00:00Z" } };
    expect(toEvent({ id: "1", summary: " Standup ", ...timed })?.title).toBe("Standup");
    expect(toEvent({ id: "2", status: "cancelled", ...timed })).toBeNull();
    expect(toEvent({ id: "3", eventType: "outOfOffice", ...timed })).toBeNull();
    expect(toEvent({ id: "4", attendees: [{ self: true, responseStatus: "declined" }], ...timed })).toBeNull();
    expect(toEvent({ id: "5", start: {}, end: {} })).toBeNull();
  });

  it("explains a disabled Calendar API", () => {
    const body = JSON.stringify({ error: { message: "Google Calendar API has not been used in project 123 before", details: [] } });
    const p = CalendarProblem.google(403, body);
    expect(p.fixLabel).toBe("Enable Calendar API");
    expect(p.fixUrl).toContain("project=123");
  });
});

describe("misc", () => {
  it("normalises int IDs to strings", () => {
    expect(normaliseIds({ id: 5, project_id: 7, hours: 1, task: { id: 9 } })).toEqual({ id: "5", project_id: "7", hours: 1, task: { id: "9" } });
  });

  it("computes weeks", () => {
    const wed = new Date(2026, 10, 18); // Wed 18 Nov 2026
    expect(dayKey(startOfWeek(wed, 1))).toBe("2026-11-16");
    expect(dayKey(startOfWeek(wed, 0))).toBe("2026-11-15");
    expect(weekNumber(wed)).toBe(47);
  });
});

import * as targets from "./targets";

describe("targets", () => {
  const base = {
    workdays: [1, 2, 3, 4, 5],
    alternatingWeeks: false,
    oddWeekWorkdays: [1, 2, 3, 4],
    customDayHours: false,
    dayHours: {} as Record<number, number>,
    oddWeekDayHours: {} as Record<number, number>,
  };
  const oddMon = new Date(2026, 10, 16); // week 47 → odd
  const evenMon = new Date(2026, 10, 23); // week 48 → even
  const evenFri = new Date(2026, 10, 27);
  const oddFri = new Date(2026, 10, 20);

  it("spreads the capacity over the work days", () => {
    expect(targets.dailyTargetSeconds(base, 40 * 3600)).toBe(8 * 3600);
    expect(targets.dailyTargetSeconds(base, null)).toBe(8 * 3600);
    expect(targets.targetOn(base, 40 * 3600, new Date(2026, 10, 22))).toBe(0); // Sunday
  });

  it("alternates work days between even and odd weeks", () => {
    const p = { ...base, alternatingWeeks: true };
    // 36 h over (5 + 4) / 2 = 4.5 days = 8 h a day.
    expect(targets.dailyTargetSeconds(p, 36 * 3600)).toBe(8 * 3600);
    expect(targets.isWorkday(p, evenFri)).toBe(true);
    expect(targets.isWorkday(p, oddFri)).toBe(false);
    expect(targets.isWorkday(p, oddMon)).toBe(true);
  });

  it("uses own hours per day", () => {
    const p = { ...base, customDayHours: true, dayHours: { 1: 8, 2: 4, 3: 0 } };
    expect(targets.targetOn(p, 40 * 3600, evenMon)).toBe(8 * 3600);
    expect(targets.targetOn(p, 40 * 3600, new Date(2026, 10, 24))).toBe(4 * 3600);
    expect(targets.isWorkday(p, new Date(2026, 10, 25))).toBe(false);
  });

  it("fills own hours from the automatic split", () => {
    const filled = targets.filledDayHours({ ...base, alternatingWeeks: true }, 36 * 3600);
    expect(filled.dayHours[1]).toBe(8);
    expect(filled.dayHours[0]).toBe(0);
    expect(filled.oddWeekDayHours[5]).toBe(0);
  });

  it.each([["4", 4], ["4,5", 4.5], ["4:30", 4.5], ["4h30", 4.5], ["", 0], ["off", 0], ["13", 13]])("parses day hours %j", (raw, h) => {
    expect(targets.parseDayHours(raw)).toBe(h);
  });
  it.each(["25", "4:75", "abc"])("rejects day hours %j", (raw) => expect(targets.parseDayHours(raw)).toBeNull());
});
