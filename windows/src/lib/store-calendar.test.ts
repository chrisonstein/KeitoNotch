// AppStore's Google Calendar cache, with Tauri and the Google client stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  // Node has no localStorage; prefs.ts reads and writes it.
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
  };
  return { events: vi.fn() };
});

vi.mock("./native", () => ({ http: vi.fn(), native: {}, openExternal: vi.fn(), secrets: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(), listen: vi.fn(async () => () => undefined) }));
vi.mock("./google", async (importOriginal) => {
  const real = await importOriginal<typeof import("./google")>();
  return {
    ...real,
    GoogleAuth: class {},
    GoogleCalendarClient: class {
      events = h.events;
      calendars = async () => [{ id: "primary", name: "Me", isPrimary: true }];
    },
  };
});

import { AppStore } from "./store";
import type { CalendarEvent } from "./models";

const day = new Date(2026, 10, 20);
const meeting = (title: string): CalendarEvent =>
  ({ id: title, title, start: new Date(2026, 10, 20, 10), end: new Date(2026, 10, 20, 11), calendarId: "primary" }) as unknown as CalendarEvent;

function connectedStore(): AppStore {
  const s = new AppStore();
  s.prefs = { ...s.prefs, calendarEnabled: true, googleCalendarIds: null };
  s.googleSignedIn = true;
  s.creds = { ...s.creds, googleClientId: "id", googleClientSecret: "secret" };
  return s;
}

beforeEach(() => {
  h.events.mockReset();
  vi.useRealTimers();
});

describe("calendar cache", () => {
  it("a failed load is not remembered: the next visit loads again", async () => {
    const s = connectedStore();
    h.events.mockRejectedValueOnce(new Error("network down"));
    await s.loadCalendar(day);
    expect(s.calendarError).not.toBeNull();
    h.events.mockResolvedValueOnce([meeting("Standup")]);
    await s.loadCalendar(day);
    expect(s.eventsOn(day).map((e) => e.title)).toEqual(["Standup"]);
    expect(s.calendarError).toBeNull();
  });

  it("a good load is reused for a few minutes, then refreshed", async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 20, 9, 0), toFake: ["Date"] });
    const s = connectedStore();
    h.events.mockResolvedValue([meeting("Standup")]);
    await s.loadCalendar(day);
    await s.loadCalendar(day);
    expect(h.events).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(2026, 10, 20, 9, 6));
    h.events.mockResolvedValue([meeting("Standup"), meeting("Planned later")]);
    await s.loadCalendar(day);
    expect(h.events).toHaveBeenCalledTimes(2);
    expect(s.eventsOn(day)).toHaveLength(2);
  });

  it("choosing other calendars drops what was loaded with the old choice", async () => {
    const s = connectedStore();
    h.events.mockResolvedValue([meeting("Standup")]);
    await s.loadCalendar(day);
    localStorage.setItem("keitonotch.prefs", JSON.stringify({ ...s.prefs, googleCalendarIds: ["team"] }));
    s.reloadPrefs();
    expect(s.eventsOn(day)).toEqual([]);
  });
});
