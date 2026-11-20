import { describe, expect, it, vi } from "vitest";

vi.mock("./native", () => ({ http: vi.fn(), native: {}, openExternal: vi.fn(), secrets: { get: vi.fn(), set: vi.fn() } }));

import { idleStep, IDLE_LIMIT_SECS, type IdleState } from "./idle";

const T0 = new Date(2026, 10, 20, 12, 0, 0).getTime();
const min = 60_000;

describe("idle reminder", () => {
  it("asks after 10+ minutes without input, once you're back", () => {
    let s: IdleState = { since: null, lastCheckAt: T0 };
    let r = idleStep(s, T0 + 15 * min, 15 * 60); // still away
    expect(r.prompt).toBeNull();
    s = r;
    r = idleStep(s, T0 + 15 * min + 5000, 2); // back
    expect(r.prompt).toEqual({ start: new Date(T0), end: new Date(T0 + 15 * min + 3000) });
  });

  it("stays quiet for a short pause", () => {
    const r = idleStep({ since: null, lastCheckAt: T0 }, T0 + 5000, 120);
    expect(r.prompt).toBeNull();
    expect(r.since).toBeNull();
  });

  it("asks after sleep: the clock jumped while the app was frozen, input is fresh", () => {
    // Lid closed at T0 (last check), opened 45 min later; you typed your PIN 3 s ago.
    const r = idleStep({ since: null, lastCheckAt: T0 }, T0 + 45 * min, 3);
    expect(r.prompt).toEqual({ start: new Date(T0), end: new Date(T0 + 45 * min - 3000) });
  });

  it("after sleep without input yet, keeps waiting with the absence from the last check", () => {
    const r = idleStep({ since: null, lastCheckAt: T0 }, T0 + 45 * min, 40);
    expect(r.prompt).toBeNull();
    expect(r.since).toEqual(new Date(T0));
  });

  it("an earlier absence start wins over the last check", () => {
    const since = new Date(T0 - 12 * min);
    const r = idleStep({ since, lastCheckAt: T0 }, T0 + 45 * min, 3);
    expect(r.prompt?.start).toEqual(since);
  });

  it("no previous check (timer just started) is never a jump", () => {
    const r = idleStep({ since: null, lastCheckAt: 0 }, T0, 3);
    expect(r.prompt).toBeNull();
  });

  it("a gap just under the limit is not an absence", () => {
    const r = idleStep({ since: null, lastCheckAt: T0 }, T0 + (IDLE_LIMIT_SECS - 1) * 1000, 3);
    expect(r.prompt).toBeNull();
  });
});
