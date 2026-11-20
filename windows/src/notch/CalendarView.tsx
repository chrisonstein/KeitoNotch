// Meetings of the selected day from Google Calendar; click one to log it. Port of CalendarView.swift.
import { useEffect } from "react";
import { useStore } from "../lib/store";
import { native, openExternal } from "../lib/native";
import { dayKey, isToday, shortDay } from "../lib/dates";
import * as fmt from "../lib/duration";
import type { CalendarProblem } from "../lib/google";
import type { CalendarEvent } from "../lib/models";
import { Check, ChevronLeft, ChevronRight, Close, External, Plus, Refresh, Warning } from "../icons";
import { IconButton, ProjectDot, Spinner, TicketChip } from "./parts";
import type { Nav } from "./NotchApp";

export function CalendarView({ nav }: { nav: Nav }) {
  const s = useStore();
  const day = s.selectedDay;
  const key = dayKey(day);

  useEffect(() => {
    void s.loadCalendar(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, s.calendarConnected]);

  const events = s.eventsOn(day);
  return (
    <div className="panel">
      <div className="panel-header">
        <IconButton label="Back to day view" onClick={() => nav.back()}><ChevronLeft /></IconButton>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span className="panel-title">Google Calendar</span>
          <span className="panel-sub">{shortDay(day)}{isToday(day) ? " · Today" : ""}</span>
        </div>
        <span className="grow" />
        {s.calendarLoading && <Spinner />}
        <IconButton label="Previous day" onClick={() => s.shiftDay(-1)}><ChevronLeft /></IconButton>
        <IconButton label="Next day" onClick={() => s.shiftDay(1)} disabled={isToday(day)}><ChevronRight /></IconButton>
        <IconButton label="Refresh" onClick={() => void s.loadCalendar(day, true)}><Refresh /></IconButton>
        <IconButton label="Close" onClick={() => nav.set("collapsed")}><Close /></IconButton>
      </div>
      {s.calendarError && <ProblemCard problem={s.calendarError} />}
      <div className="panel-body">
        {!s.calendarConnected ? (
          <div className="empty" style={{ padding: "0 30px", textAlign: "center" }}>
            <b style={{ color: "var(--fg)", fontSize: 15 }}>Connect Google Calendar</b>
            <span>Sign in with Google in Settings to log meetings as time. Keito Notch only reads your calendar.</span>
            <button className="pill primary" onClick={() => void native.openSettings("calendar")}>Open Settings</button>
          </div>
        ) : events.length === 0 ? (
          <div className="empty">{s.calendarLoading ? "Loading meetings…" : "No meetings on this day."}</div>
        ) : (
          <div className="entries" style={{ paddingBottom: 10 }}>
            {events.map((e) => <EventRow key={e.id} event={e} onLog={() => nav.openForm({ event: e })} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event, onLog }: { event: CalendarEvent; onLog: () => void }) {
  const s = useStore();
  const logged = s.loggedEntry(event);
  const match = s.match(event);
  return (
    <div
      className="entry"
      role="button"
      style={{ cursor: "pointer", opacity: logged ? 0.6 : 1 }}
      title={match.reason ? `Log this meeting · ${match.reason}` : "Log this meeting"}
      onClick={onLog}
    >
      <div className="main">
        <span className="project ellipsis">{event.title || "(No title)"}</span>
        <div className="meta">
          <span className="num">{fmt.hhmm(event.start)}</span>
          {match.project ? (
            <>
              <ProjectDot id={match.project.id} />
              <span className="ellipsis">{match.project.name}</span>
            </>
          ) : (
            <span>No project match</span>
          )}
          {match.jiraKey && <TicketChip ticketKey={match.jiraKey} url={s.ticketUrl(match.jiraKey)} />}
        </div>
      </div>
      <span className="dur num" style={{ color: logged ? "var(--muted)" : undefined }}>
        {fmt.hoursLabel((+event.end - +event.start) / 3600_000)}
      </span>
      {logged ? (
        <span className="mini-btn" style={{ border: "none", color: "var(--live)" }} title="Already logged" aria-label="Already logged">
          <Check size={16} />
        </span>
      ) : (
        <span className="mini-btn" aria-label="Log this meeting"><Plus size={11} strokeWidth={2.4} /></span>
      )}
    </div>
  );
}

export function ProblemCard({ problem }: { problem: CalendarProblem }) {
  return (
    <div className="card warn" style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <span style={{ color: "var(--overtime)" }}><Warning /></span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <b>{problem.title}</b>
        <span className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{problem.detail}</span>
        {problem.fixLabel && problem.fixUrl && (
          <button className="pill ghost small" style={{ alignSelf: "flex-start", color: "var(--accent)" }} onClick={() => void openExternal(problem.fixUrl!)}>
            {problem.fixLabel} <External size={10} />
          </button>
        )}
      </div>
    </div>
  );
}
