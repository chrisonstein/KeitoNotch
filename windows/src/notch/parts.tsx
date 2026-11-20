// Shared building blocks for the notch views.
import type { ReactNode } from "react";
import { openExternal } from "../lib/native";
import { External } from "../icons";

/** Keito has no project colours, so each project gets a stable one (same palette and hash as the Mac app). */
const PALETTE = ["#8E9BFF", "#3DDC84", "#F5B451", "#F27BB0", "#5CC8FF", "#FF8A65", "#B39DDB", "#4DD0C4"];

export function projectColor(id?: string | null): string {
  if (!id) return "var(--muted)";
  let hash = 0;
  for (const ch of id) hash = (Math.imul(hash, 31) + ch.codePointAt(0)!) & 0x7fffffff;
  return PALETTE[hash % PALETTE.length];
}

export function ProjectDot({ id }: { id?: string | null }) {
  return <span className="dot" style={{ background: projectColor(id) }} aria-hidden />;
}

export function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button className="icon-btn" title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />;

export const Kbd = ({ children }: { children: ReactNode }) => <span className="kbd">{children}</span>;

/** "Customer · Task", the customer slightly stronger. */
export function ClientTask({ client, task }: { client?: string; task?: string | null }) {
  return (
    <span className="ellipsis" title={[client, task].filter(Boolean).join(" · ")}>
      {client && <b style={{ fontWeight: 600, color: "var(--note)" }}>{client}</b>}
      {client && task ? "  ·  " : ""}
      {task}
    </span>
  );
}

/** Jira key chip; opens the ticket in the browser when there's a link. */
export function TicketChip({ ticketKey, url }: { ticketKey: string; url?: string }) {
  if (!url) return <span className="chip">{ticketKey}</span>;
  return (
    <button
      className="chip"
      title={`Open ${ticketKey} in your browser`}
      onClick={(e) => {
        e.stopPropagation();
        void openExternal(url);
      }}
    >
      {ticketKey} <External size={8} />
    </button>
  );
}

/** Today's booked time as a ring: full = daily target; overtime laps in amber. */
export function DayRing({ fraction, size, width = 3 }: { fraction: number; size: number; width?: number }) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const arc = (f: number, color: string) => (
    <circle
      cx={size / 2}
      cy={size / 2}
      r={r}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={`${c * Math.min(1, Math.max(0, f))} ${c}`}
      transform={`rotate(-90 ${size / 2} ${size / 2})`}
      style={{ transition: "stroke-dasharray 0.4s ease-out" }}
    />
  );
  return (
    <svg width={size} height={size} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bar-track)" strokeWidth={width} />
      {fraction > 0 && arc(fraction, "var(--live)")}
      {fraction > 1 && arc(fraction - 1, "var(--overtime)")}
    </svg>
  );
}
