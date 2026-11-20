// Daily and weekly targets — port of the "Targets" part of AppState.swift.
// Work days can differ in even and odd weeks; optionally you set your own hours per weekday.
import { weekNumber } from "./dates";
import type { Prefs } from "./prefs";

type TargetPrefs = Pick<Prefs, "workdays" | "alternatingWeeks" | "oddWeekWorkdays" | "customDayHours" | "dayHours" | "oddWeekDayHours">;

const isEvenWeek = (day: Date) => weekNumber(day) % 2 === 0;

/** Own hours per weekday for the week containing `day`. */
export function dayHoursFor(p: TargetPrefs, day: Date): Record<number, number> {
  if (!p.alternatingWeeks) return p.dayHours;
  return isEvenWeek(day) ? p.dayHours : p.oddWeekDayHours;
}

/** Work days (JS weekdays) for the week containing `day`. With own hours: any day with hours. */
export function workdaysFor(p: TargetPrefs, day: Date): number[] {
  if (p.customDayHours) {
    const h = dayHoursFor(p, day);
    return [0, 1, 2, 3, 4, 5, 6].filter((d) => (h[d] ?? 0) > 0);
  }
  if (!p.alternatingWeeks) return p.workdays;
  return isEvenWeek(day) ? p.workdays : p.oddWeekWorkdays;
}

export const isWorkday = (p: TargetPrefs, day: Date) => workdaysFor(p, day).includes(day.getDay());

/** Average work days per week (4.5 with alternating 4/5-day weeks). */
function averageWorkdays(p: TargetPrefs): number {
  const even = p.workdays.length;
  if (!p.alternatingWeeks) return Math.max(1, even);
  return Math.max(1, (even + p.oddWeekWorkdays.length) / 2);
}

/** Keito weekly capacity spread over your average work days (36 h over 4.5 = 8 h); 8 h without a capacity. */
export function dailyTargetSeconds(p: TargetPrefs, weeklyCapacity?: number | null): number {
  if (weeklyCapacity && weeklyCapacity > 0) return weeklyCapacity / averageWorkdays(p);
  return 8 * 3600;
}

export function targetOn(p: TargetPrefs, weeklyCapacity: number | null | undefined, day: Date): number {
  if (p.customDayHours) return (dayHoursFor(p, day)[day.getDay()] ?? 0) * 3600;
  return isWorkday(p, day) ? dailyTargetSeconds(p, weeklyCapacity) : 0;
}

/** Turning own hours on fills in today's automatic targets, so nothing changes until you edit a day. */
export function filledDayHours(p: TargetPrefs, weeklyCapacity?: number | null): Pick<Prefs, "dayHours" | "oddWeekDayHours"> {
  const auto = Math.round((dailyTargetSeconds(p, weeklyCapacity) / 3600) * 100) / 100;
  const fill = (days: number[]) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, days.includes(d) ? auto : 0]));
  return { dayHours: fill(p.workdays), oddWeekDayHours: fill(p.alternatingWeeks ? p.oddWeekWorkdays : p.workdays) };
}

/** Hour fields: "4", "4,5", "4:30", "4h30" → hours; empty, "0", "-" or "off" = 0. null = can't read. */
export function parseDayHours(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(",", ".");
  if (!s || s === "off" || s === "-" || s === "0:00") return 0;
  // A bare number is always hours here ("13" is a 13-hour day, not 13 minutes).
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return n <= 24 ? Math.round(n * 100) / 100 : null;
  }
  const m = /^(\d+)(?::|h)(\d{1,2})m?$/.exec(s);
  if (m && +m[2] < 60) return Math.round((+m[1] + +m[2] / 60) * 100) / 100;
  return null;
}
