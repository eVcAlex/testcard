import type { ComponentChildren } from "preact";

/** The desktop app's icon set (16-unit grid, 1.5 stroke, currentColor): the few of them the web player uses. */
export type IconName = "search" | "star" | "tv" | "clock" | "play" | "back" | "x" | "film" | "layers" | "check" | "signal" | "refresh" | "lock" | "chevron";

const PATHS: Record<IconName, ComponentChildren> = {
  search: (<><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></>),
  star: <path d="M8 1.7l1.9 4 4.4.6-3.2 3.1.8 4.3L8 11.7 3.3 13.7l.8-4.3L.9 6.3l4.4-.6z" />,
  tv: (<><rect x="1.5" y="3.5" width="13" height="9" rx="1.2" /><path d="M5.5 14.5h5" /></>),
  clock: (<><circle cx="8" cy="8" r="6.3" /><path d="M8 4.3V8l2.6 1.6" /></>),
  play: <path d="M4.5 3.2v9.6l8-4.8z" />,
  back: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  film: (<><rect x="2" y="2.5" width="12" height="11" rx="1.2" /><path d="M2 5.5h12M2 10.5h12" /><circle cx="4.5" cy="4" r="0.6" /><circle cx="11.5" cy="4" r="0.6" /><circle cx="4.5" cy="12" r="0.6" /><circle cx="11.5" cy="12" r="0.6" /></>),
  layers: (<><path d="M8 2.5 14 6 8 9.5 2 6z" /><path d="M2 9.5 8 13l6-3.5" /></>),
  check: <path d="M3.5 8.5l3 3 6-7" />,
  signal: <path d="M2 11l3-3 2.5 2.5L11 7l3 3" />,
  refresh: (<><path d="M13 8a5 5 0 1 1-1.5-3.5" /><path d="M13 2.5V5h-2.5" /></>),
  lock: (<><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></>),
  chevron: <path d="M4 6.5 8 10.5 12 6.5" />,
};
const FILLED: Partial<Record<IconName, true>> = { star: true, play: true };

export function Icon({ name, size = 16, filled }: { name: IconName; size?: number; filled?: boolean }) {
  const solid = filled ?? FILLED[name] === true;
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill={solid ? "currentColor" : "none"} stroke={solid ? "none" : "currentColor"} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
