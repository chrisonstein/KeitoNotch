// Durations — port of DurationFormat.swift. Durations only, never start/end times.

const pad = (n: number) => String(n).padStart(2, "0");

function positive(h: number): number | null {
  if (!(h > 0 && h < 24)) return null;
  return Math.round(h * 100) / 100;
}

/** "1:30", "1.5", "1,5", "1h30", "1h 30m", "90m", "45" (minutes if > 12, else hours) → decimal hours. */
export function parseHours(raw: string): number | null {
  const s = raw.toLowerCase().replace(/\s/g, "").replace(/,/g, ".").replace(/min/g, "m");
  if (!s) return null;

  if (s.includes(":")) {
    const parts = s.split(":");
    if (parts.length !== 2) return null;
    const h = parts[0] === "" ? 0 : intOrNull(parts[0]);
    const m = intOrNull(parts[1]);
    if (h === null || m === null || m < 0 || m >= 60 || h < 0) return null;
    return positive(h + m / 60);
  }
  if (s.includes("h") || s.endsWith("m")) {
    let hours = 0;
    let mins = 0;
    let rest = s;
    const hIdx = rest.indexOf("h");
    if (hIdx >= 0) {
      const h = numOrNull(rest.slice(0, hIdx));
      if (h === null) return null;
      hours = h;
      rest = rest.slice(hIdx + 1);
    }
    if (rest.endsWith("m")) rest = rest.slice(0, -1);
    if (rest) {
      const m = numOrNull(rest);
      if (m === null) return null;
      mins = m;
    }
    return positive(hours + mins / 60);
  }
  const n = numOrNull(s);
  if (n === null) return null;
  // Bare integers above 12 are almost certainly minutes ("45" → 0.75h).
  if (n > 12 && Number.isInteger(n)) return positive(n / 60);
  return positive(n);
}

function intOrNull(s: string): number | null {
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

function numOrNull(s: string): number | null {
  return /^\d*\.?\d+$|^\d+\.$/.test(s) ? parseFloat(s) : null;
}

/** Compact "1:23" (h:mm). */
export function short(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}`;
}

/** Running timer: "1:23" or, with seconds, "1:23:45". */
export function timer(seconds: number, showSeconds: boolean): string {
  if (!showSeconds) return short(seconds);
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

/** 1.5 → "1:30". */
export function hoursLabel(h: number): string {
  const mins = Math.round(h * 60);
  return `${Math.floor(mins / 60)}:${pad(mins % 60)}`;
}

/** 5400 → "1h 30m". */
export function words(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const parts = [Math.floor(mins / 60) > 0 ? `${Math.floor(mins / 60)}h` : "", mins % 60 > 0 ? `${mins % 60}m` : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : "0m";
}

/** Local wall-clock "HH:mm". */
export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** " · +0:45 over" when logged exceeds target. */
export function overTargetSuffix(logged: number, target: number): string {
  if (target <= 0 || logged - target < 60) return "";
  return ` · +${short(logged - target)} over`;
}
