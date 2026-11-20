// Day view (392×600): ‹ day ›, week strip, week total, the day's entries, New entry. Port of DayView.swift.
import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { native } from "../lib/native";
import { dayKey, dayLabel, isSameDay, isToday, narrowDay, shortDay } from "../lib/dates";
import * as fmt from "../lib/duration";
import { projectIdOf, type TimeEntry } from "../lib/models";
import { CalendarIcon, ChevronLeft, ChevronRight, Close, Gear, Lock, Pencil, Play, Plus, Stop } from "../icons";
import { ClientTask, IconButton, Kbd, ProjectDot, Spinner, TicketChip } from "./parts";
import type { Nav } from "./NotchApp";

export function DayView({ nav }: { nav: Nav }) {
  const s = useStore();
  const day = s.selectedDay;
  const today = isToday(day);
  const logged = s.secondsOn(day);
  const target = s.target(day);
  const weekTarget = s.weeklyTargetSeconds;

  return (
    <div className="panel">
      <div className="panel-header">
        <IconButton label="Previous day" onClick={() => s.shiftDay(-1)}><ChevronLeft /></IconButton>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span className="panel-title">{shortDay(day)}{today ? " · Today" : ""}</span>
          <span className="panel-sub">
            <span className="num">{fmt.short(logged)}</span> logged{target > 0 ? ` of ${fmt.short(target)}` : ""}
            <span style={{ color: "var(--overtime)" }}>{fmt.overTargetSuffix(logged, target)}</span>
          </span>
        </div>
        <IconButton label="Next day" onClick={() => s.shiftDay(1)}><ChevronRight /></IconButton>
        <span className="grow" />
        {s.weekLoading && <Spinner />}
        {!today && <button className="pill ghost small" onClick={() => s.selectDay(new Date())}>Today</button>}
        <IconButton label="Settings" onClick={() => void native.openSettings()}><Gear /></IconButton>
        <IconButton label="Close" onClick={() => nav.set("collapsed")}><Close /></IconButton>
      </div>

      {s.idlePrompt && <IdleBanner />}

      <div className="week">
        {s.weekDays.map((d) => <DayColumn key={dayKey(d)} day={d} />)}
      </div>
      <div className="row muted" style={{ padding: "8px 16px 0", fontSize: 12 }}>
        <span>Week {s.weekNumber}</span>
        <span className="grow" />
        <span className="num"><b style={{ color: "var(--fg)", fontWeight: 600 }}>{fmt.short(s.weekSeconds)}</b> / {fmt.short(weekTarget)}</span>
      </div>
      <div className="progress" role="progressbar" aria-label="Week progress" aria-valuenow={Math.round((s.weekSeconds / Math.max(1, weekTarget)) * 100)}>
        <div style={{ width: `${Math.min(100, (s.weekSeconds / Math.max(1, weekTarget)) * 100)}%` }} />
      </div>

      <div className="panel-body">
        <EntryList nav={nav} />
      </div>

      <div className="panel-footer">
        {s.lastError && <div className="error">{s.lastError}</div>}
        {nav.restartPrompt ? (
          <RestartPrompt entry={nav.restartPrompt} nav={nav} />
        ) : (
          <div className="row">
            <button className="pill primary grow" onClick={() => nav.openForm({ date: day })}>
              <Plus size={12} strokeWidth={2.4} /> New entry <Kbd>N</Kbd>
            </button>
            {s.calendarConnected && (
              <button className="pill outline" title="Log a meeting from your calendar" onClick={() => nav.set("calendar")}>
                <CalendarIcon size={13} /> From calendar <Kbd>C</Kbd>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DayColumn({ day }: { day: Date }) {
  const s = useStore();
  const today = isToday(day);
  const selected = isSameDay(day, s.selectedDay);
  const off = !s.isWorkday(day);
  const secs = s.secondsOn(day);
  const fraction = Math.min(1, secs / Math.max(1, off ? s.dailyTargetSeconds : s.target(day)));
  return (
    <button
      className={`wd ${today ? "today" : ""} ${selected ? "selected" : ""}`}
      title={shortDay(day) + (off ? " · day off" : "")}
      aria-label={`${day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}${today ? ", today" : ""}${off ? ", day off" : ""}, ${fmt.words(secs)} logged`}
      aria-pressed={selected}
      onClick={() => s.selectDay(day)}
    >
      <span className="letter">{narrowDay(day)}</span>
      <span className={`bar ${off ? "off" : ""}`}>
        <span className="fill" style={{ height: `${fraction * 100}%` }} />
      </span>
      <span className="val num" style={{ color: off ? "var(--muted)" : undefined }}>{off && secs === 0 ? "–" : fmt.short(secs)}</span>
    </button>
  );
}

interface RowMenu {
  x: number;
  y: number;
  entry: TimeEntry;
}

function EntryList({ nav }: { nav: Nav }) {
  const s = useStore();
  const day = s.selectedDay;
  const entries = s.entriesOn(day);
  const [menu, setMenu] = useState<RowMenu | null>(null);

  // Any click, scroll or key closes the menu.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("wheel", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("wheel", close);
    };
  }, [menu]);
  if (!entries.length) {
    return (
      <div className="empty">
        <span>{s.weekLoading || !s.loaded ? "Loading…" : s.isWorkday(day) ? "No time logged on this day." : "Day off. Nothing to log."}</span>
        <button className="pill ghost" onClick={() => nav.openForm({ date: day })}><Plus size={12} /> Add entry</button>
      </div>
    );
  }
  return (
    <div className="entries">
      {entries.map((e) => (
        <EntryRow
          key={e.id}
          entry={e}
          nav={nav}
          onMenu={(x, y) => setMenu({ x: Math.min(x, document.documentElement.clientWidth - 190), y, entry: e })}
        />
      ))}
      {menu && (
        <div className="menu" role="menu" style={{ left: menu.x, top: menu.y, position: "fixed" }} onMouseDown={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => { nav.openForm({ editing: menu.entry }); setMenu(null); }}>Edit…</button>
          <button role="menuitem" onClick={() => { s.addFavorite(menu.entry); setMenu(null); }}>Add to favourites</button>
        </div>
      )}
    </div>
  );
}

function EntryRow({ entry, nav, onMenu }: { entry: TimeEntry; nav: Nav; onMenu: (x: number, y: number) => void }) {
  const s = useStore();
  const running = s.running?.id === entry.id;
  const locked = entry.is_locked === true;
  const ref = entry.external_reference;
  const edit = () => nav.openForm({ editing: entry });
  return (
    <div
      className={`entry ${running ? "running" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      <div className="main" onClick={edit} title={locked ? "Approved or invoiced" : "Edit entry"}>
        <div className="row" style={{ gap: 7 }}>
          <ProjectDot id={projectIdOf(entry)} />
          <span className="project ellipsis">{s.projectName(entry)}</span>
        </div>
        <div className="meta">
          <ClientTask client={s.clientName(entry)} task={entry.task?.name} />
          {ref && <TicketChip ticketKey={ref.id} url={s.ticketUrl(ref.id, ref.permalink)} />}
        </div>
        {entry.notes && <div className="notes ellipsis">{entry.notes}</div>}
      </div>
      <IconButton label={locked ? "Approved or invoiced: view only" : "Edit entry"} onClick={edit}>
        {locked ? <Lock size={12} /> : <Pencil size={12} />}
      </IconButton>
      <span className="dur num">{running ? fmt.timer(s.elapsed, s.prefs.showSeconds) : fmt.short((entry.hours ?? 0) * 3600)}</span>
      <button
        className={`mini-btn ${running ? "running" : ""}`}
        title={running ? "Stop" : "Resume"}
        aria-label={running ? "Stop timer" : "Resume timer"}
        disabled={s.isBusy}
        onClick={() => (running ? void s.stopRunning() : nav.requestResume(entry))}
      >
        {running ? <Stop size={10} /> : <Play size={10} />}
      </button>
    </div>
  );
}

/** "Run it today?" for an entry from another day. */
function RestartPrompt({ entry, nav }: { entry: TimeEntry; nav: Nav }) {
  const s = useStore();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row" style={{ gap: 7 }}>
        <ProjectDot id={projectIdOf(entry)} />
        <b className="ellipsis">Run {s.projectName(entry)} today?</b>
      </div>
      <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
        It's from {dayLabel(entry.spent_date)}. This adds a new running entry for today with the same task, notes and ticket; the original stays.
      </span>
      <div className="row">
        <button className="pill ghost" onClick={() => nav.setRestartPrompt(null)}>Cancel</button>
        <button
          className="pill live grow"
          disabled={s.isBusy}
          onClick={async () => {
            await s.continueToday(entry);
            nav.setRestartPrompt(null);
          }}
        >
          <Play size={10} /> Start today
        </button>
      </div>
    </div>
  );
}

/** After 10+ minutes without input while a timer ran. */
function IdleBanner() {
  const s = useStore();
  const span = s.idlePrompt!;
  return (
    <div className="card accent">
      <b>You were away {fmt.words((+span.end - +span.start) / 1000)}</b>
      <span className="muted" style={{ fontSize: 11.5 }}>{fmt.hhmm(span.start)}–{fmt.hhmm(span.end)} while the timer ran.</span>
      <div className="row" style={{ gap: 6 }}>
        <button className="pill ghost" disabled={s.isBusy} onClick={() => s.keepIdleTime()}>Keep</button>
        <button className="pill primary grow" disabled={s.isBusy} onClick={() => void s.removeIdleTime(false)}>Remove</button>
        <button className="pill danger grow" disabled={s.isBusy} onClick={() => void s.removeIdleTime(true)}>Stop at {fmt.hhmm(span.start)}</button>
      </div>
    </div>
  );
}
