import { describe, expect, it, vi } from "vitest";

vi.mock("./native", () => ({ http: vi.fn(), native: {}, openExternal: vi.fn(), secrets: { get: vi.fn(), set: vi.fn() } }));

import { idleStep, IDLE_LIMIT_SECS, type IdleState } from "./idle";
import { APIError, friendlyError } from "./keito";

describe("server error reasons", () => {
  // Body shape from https://keito.ai/docs/api-reference/error-handling (read 2026-11-20).
  it("shows Keito's error_description", () => {
    const e = new APIError(400, JSON.stringify({ error: "bad request", error_description: "Notes are required for this project" }));
    expect(friendlyError(e)).toBe("Notes are required for this project (400)");
  });

  it("shows a plain message field", () => {
    const e = new APIError(422, JSON.stringify({ message: "Time entries in an approved week cannot be changed" }));
    expect(friendlyError(e)).toBe("Time entries in an approved week cannot be changed (422)");
  });

  it("shows Jira's errorMessages", () => {
    const e = new APIError(400, JSON.stringify({ errorMessages: ["The value 'X' does not exist for the field 'project'."], errors: {} }));
    expect(friendlyError(e)).toBe("The value 'X' does not exist for the field 'project'. (400)");
  });

  it("explains a 409 conflict without dumping JSON", () => {
    const e = new APIError(409, JSON.stringify({ error: "conflict", error_description: "Approved time entries cannot be deleted" }));
    expect(friendlyError(e)).toBe("Approved time entries cannot be deleted (409)");
  });

  it("keeps the timer-conflict text", () => {
    expect(friendlyError(new APIError(409, "{}", "Another timer is already running."))).toBe("Another timer is already running.");
  });

  it("falls back to the status when the body says nothing useful", () => {
    expect(friendlyError(new APIError(500, "<html>oops</html>"))).toBe("The server answered with error 500.");
  });

  it("keeps the setup hints for 401", () => {
    expect(friendlyError(new APIError(401, JSON.stringify({ error: "unauthorized" })))).toMatch(/rejected \(401\)/);
  });
});

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
