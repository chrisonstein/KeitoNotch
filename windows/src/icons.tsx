// Small stroke icons (Fluent-like weight), 1em by default.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 14, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...rest,
});

export const ChevronLeft = (p: P) => <svg {...base(p)}><path d="M10 3 5 8l5 5" /></svg>;
export const ChevronRight = (p: P) => <svg {...base(p)}><path d="m6 3 5 5-5 5" /></svg>;
export const ChevronDown = (p: P) => <svg {...base(p)}><path d="m4 6 4 4 4-4" /></svg>;
export const Close = (p: P) => <svg {...base(p)}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
export const Plus = (p: P) => <svg {...base(p)}><path d="M8 3v10M3 8h10" /></svg>;
export const Play = (p: P) => <svg {...base(p)} fill="currentColor" stroke="none"><path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z" /></svg>;
export const Stop = (p: P) => <svg {...base(p)} fill="currentColor" stroke="none"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" /></svg>;
export const Pencil = (p: P) => <svg {...base(p)}><path d="M10.5 2.5l3 3L6 13l-3.5.5L3 10z" /></svg>;
export const Lock = (p: P) => <svg {...base(p)}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>;
export const Trash = (p: P) => <svg {...base(p)}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>;
export const CalendarIcon = (p: P) => <svg {...base(p)}><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 7h11M5.5 2v3M10.5 2v3" /></svg>;
export const Gear = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
  </svg>
);
export const Check = (p: P) => <svg {...base(p)}><path d="m3 8.5 3 3 7-7" /></svg>;
export const Refresh = (p: P) => <svg {...base(p)}><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" /></svg>;
export const External = (p: P) => <svg {...base(p)}><path d="M6 3H3.5v9.5H13V10M9 2.5h4.5V7M13.5 2.5 7.5 8.5" /></svg>;
export const Warning = (p: P) => <svg {...base(p)}><path d="M8 2 1.8 13h12.4z" /><path d="M8 6.5v3M8 11.3v.2" /></svg>;
export const Key = (p: P) => <svg {...base(p)}><circle cx="5.5" cy="10.5" r="3" /><path d="m7.6 8.4 5.9-5.9M11 5l1.5 1.5" /></svg>;
export const Ticket = (p: P) => <svg {...base(p)}><path d="M2.5 5.5V4h11v1.5a2.5 2.5 0 0 0 0 5V12h-11v-1.5a2.5 2.5 0 0 0 0-5Z" /></svg>;
export const Monitor = (p: P) => <svg {...base(p)}><rect x="2" y="2.5" width="12" height="8.5" rx="1.5" /><path d="M5.5 13.5h5M8 11v2.5" /></svg>;
export const Week = (p: P) => <svg {...base(p)}><path d="M3 12V7M6 12V4M9 12V6M12 12V9" /></svg>;
export const Power = (p: P) => <svg {...base(p)}><path d="M8 2v6M4.5 4.5a5 5 0 1 0 7 0" /></svg>;
export const Star = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? "currentColor" : "none"}>
    <path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
  </svg>
);
export const ArrowUp = (p: P) => <svg {...base(p)}><path d="M8 13V3M4 7l4-4 4 4" /></svg>;
export const ArrowDown = (p: P) => <svg {...base(p)}><path d="M8 3v10M4 9l4 4 4-4" /></svg>;
export const Update = (p: P) => <svg {...base(p)}><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10" /></svg>;
