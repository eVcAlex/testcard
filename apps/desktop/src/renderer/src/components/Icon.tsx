import type { ReactNode, SVGProps } from "react";

/**
 * Inline SVG icon set — no dependency, no runtime fetch. 16-unit grid, 1.5 stroke, inherits
 * `currentColor`. `size` sets both dimensions; pass `filled` on `star` for the favourited state.
 */
export type IconName =
  | "search"
  | "star"
  | "tv"
  | "clock"
  | "plus"
  | "play"
  | "pause"
  | "skip-back"
  | "skip-forward"
  | "volume"
  | "volume-x"
  | "cc"
  | "aspect"
  | "grid"
  | "back"
  | "chevron-right"
  | "sun"
  | "moon"
  | "refresh"
  | "x"
  | "signal"
  | "fullscreen"
  | "fullscreen-exit"
  | "more"
  | "edit"
  | "trash";

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </>
  ),
  star: <path d="M8 1.7l1.9 4 4.4.6-3.2 3.1.8 4.3L8 11.7 3.3 13.7l.8-4.3L.9 6.3l4.4-.6z" />,
  tv: (
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.2" />
      <path d="M5.5 14.5h5" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 4.3V8l2.6 1.6" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  play: <path d="M4.5 3.2v9.6l8-4.8z" />,
  pause: (
    <>
      <rect x="4" y="3" width="3" height="10" rx="0.5" />
      <rect x="9" y="3" width="3" height="10" rx="0.5" />
    </>
  ),
  "skip-back": (
    <>
      <path d="M11.5 3.5v9l-6-4.5z" />
      <path d="M4.5 3.5v9" />
    </>
  ),
  "skip-forward": (
    <>
      <path d="M4.5 3.5v9l6-4.5z" />
      <path d="M11.5 3.5v9" />
    </>
  ),
  volume: (
    <>
      <path d="M3 6h2.5L9 3v10L5.5 10H3z" />
      <path d="M11 5.5c1.4 1.4 1.4 3.6 0 5" />
    </>
  ),
  "volume-x": (
    <>
      <path d="M3 6h2.5L9 3v10L5.5 10H3z" />
      <path d="M11.5 6.5l3 3M14.5 6.5l-3 3" />
    </>
  ),
  cc: (
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M6.5 7c-.4-.5-1-.7-1.6-.4-.8.3-1 1.3-.6 2 .4.6 1.2.8 1.9.4M11.5 7c-.4-.5-1-.7-1.6-.4-.8.3-1 1.3-.6 2 .4.6 1.2.8 1.9.4" />
    </>
  ),
  aspect: (
    <>
      <rect x="1.8" y="4" width="12.4" height="8" rx="1" />
      <path d="M4.5 4v8M11.5 4v8" />
    </>
  ),
  grid: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
      <path d="M2 6h12M6.5 6v7.5" />
    </>
  ),
  back: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  "chevron-right": <path d="M6 3.5 10.5 8 6 12.5" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1v1.6M8 13.4V15M2.4 2.4l1.1 1.1M12.5 12.5l1.1 1.1M1 8h1.6M13.4 8H15M2.4 13.6l1.1-1.1M12.5 3.5l1.1-1.1" />
    </>
  ),
  moon: <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />,
  refresh: (
    <>
      <path d="M13 8a5 5 0 1 1-1.5-3.5" />
      <path d="M13 2.5V5h-2.5" />
    </>
  ),
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  signal: <path d="M2 11l3-3 2.5 2.5L11 7l3 3" />,
  fullscreen: <path d="M6 2H2v4M14 6V2h-4M2 10v4h4M10 14h4v-4" />,
  "fullscreen-exit": <path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4" />,
  more: (
    <>
      <circle cx="8" cy="3.3" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="8" cy="12.7" r="1.2" />
    </>
  ),
  edit: (
    <>
      <path d="M10.5 2.5l3 3L5 14H2v-3z" />
      <path d="M9 4l3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M2.5 4.5h11" />
      <path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
      <path d="M4 4.5l.6 8.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.4" />
      <path d="M6.5 7.5v4M9.5 7.5v4" />
    </>
  ),
};

const FILLED: Partial<Record<IconName, true>> = {
  star: true,
  play: true,
  pause: true,
  "skip-back": true,
  "skip-forward": true,
  more: true,
};

export function Icon({
  name,
  size = 16,
  filled,
  ...rest
}: { name: IconName; size?: number; filled?: boolean } & Omit<SVGProps<SVGSVGElement>, "name">) {
  const solid = filled ?? FILLED[name] === true;
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
