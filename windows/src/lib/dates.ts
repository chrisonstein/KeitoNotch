// Day keys and weeks. Keito's `spent_date` is a local "yyyy-MM-dd".

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export const isSameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);
export const isToday = (d: Date) => isSameDay(d, new Date());

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** JS weekday the workspace's week starts on (Keito `week_start_day`), default Monday. */
export function weekStartDay(name?: string | null): number {
  const i = name ? WEEKDAYS.indexOf(name.toLowerCase()) : -1;
  return i >= 0 ? i : 1;
}

export function startOfWeek(d: Date, firstDay: number): Date {
  const diff = (d.getDay() - firstDay + 7) % 7;
  return addDays(startOfDay(d), -diff);
}

/** ISO-8601 week number (weeks with ≥ 4 days in the new year count as week 1), like the Mac app. */
export function weekNumber(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** "Wed 11 Nov". */
export function shortDay(d: Date): string {
  const wd = d.toLocaleDateString(undefined, { weekday: "short" });
  const mo = d.toLocaleDateString(undefined, { month: "short" });
  return `${wd} ${d.getDate()} ${mo}`;
}

/** "Today", "Yesterday" or "Mon 9 Nov". */
export function dayLabel(key?: string | null): string {
  const d = key ? fromKey(key) : null;
  if (!d) return "";
  if (isToday(d)) return "Today";
  if (isSameDay(d, addDays(new Date(), -1))) return "Yesterday";
  return shortDay(d);
}

/** One-letter weekday ("M"). */
export function narrowDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "narrow" });
}
