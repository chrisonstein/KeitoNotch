// Idle reminder: decides, from one check, whether you were away while a timer ran.
// Pure (no Tauri), so it can be tested; store.ts calls it every 5 s while a timer runs.

/** Away this long (seconds) → ask whether to keep, remove or stop. */
export const IDLE_LIMIT_SECS = 600;
/** Back at the keyboard: input within this many seconds. */
const BACK_SECS = 10;

export interface IdleState {
  /** When the current absence started, if one is in progress. */
  since: Date | null;
  /** Wall clock of the previous check (0 = none yet). */
  lastCheckAt: number;
}

export interface IdleResult extends IdleState {
  /** Set when you just came back from an absence. */
  prompt: { start: Date; end: Date } | null;
}

/**
 * One check. `nowMs` is the wall clock, `idleSecs` the seconds since the last keyboard/mouse input.
 */
export function idleStep(state: IdleState, nowMs: number, idleSecs: number): IdleResult {
  let since = state.since;
  // Sleep or hibernate freezes the app: no check runs while the lid is closed, and on wake the input
  // counter is fresh (you typed your PIN). A long gap since the previous check is that absence.
  if (state.lastCheckAt > 0 && nowMs - state.lastCheckAt >= IDLE_LIMIT_SECS * 1000) {
    const frozenAt = new Date(state.lastCheckAt);
    if (!since || frozenAt < since) since = frozenAt;
  }
  if (idleSecs >= IDLE_LIMIT_SECS) {
    since ??= new Date(nowMs - idleSecs * 1000);
  } else if (since && idleSecs < BACK_SECS) {
    return { since: null, lastCheckAt: nowMs, prompt: { start: since, end: new Date(nowMs - idleSecs * 1000) } };
  }
  return { since, lastCheckAt: nowMs, prompt: null };
}
