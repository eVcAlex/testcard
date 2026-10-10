import { Link } from "@tanstack/react-router";
import { type ReactNode, useId } from "react";

/** The seven SMPTE bars (same values as the desktop app): white, yellow, cyan, green, magenta, red, blue. Colours are set in CSS (styles.css), because the CSP forbids inline style attributes. */
export const BAR_VARS = [1, 2, 3, 4, 5, 6, 7].map((n) => `var(--bar-${n})`);

export const Br = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <p className={`br ${className}`.trim()}><span aria-hidden="true">[ </span>{children}<span aria-hidden="true"> ]</span></p>
);

/** A square of colour bars. `fit` stretches it to its box. */
export const Bars = ({ className = "" }: { className?: string }) => (
  <svg className={`bars-sq ${className}`.trim()} viewBox="0 0 70 70" aria-hidden="true" preserveAspectRatio="none">
    {BAR_VARS.map((c, i) => <rect key={c} x={i * 10} width="10.4" height="70" />)}
  </svg>
);

/** The wordmark: wide-tracked, two lines, and a square of bars stands in for a letter. */
export const Mark = ({ big = false }: { big?: boolean }) => (
  <span className={`wm${big ? " wm-big" : ""}`} aria-hidden="true">
    <span>TEST<Bars className="wm-sq" /></span>
    <span>CARD</span>
  </span>
);

export const Arrow = ({ dir = "down" }: { dir?: "down" | "left" | "right" }) => (
  <svg className={`arrow arrow-${dir}`} viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 8v80M16 56l34 34 34-34" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="square" />
  </svg>
);

/** A small test-card disc: bars inside a circle with a crosshair. */
export function Disc() {
  const id = useId();
  return (
    <svg className="disc" viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="3" className="disc-bg" />
      <clipPath id={id}><circle cx="20" cy="20" r="14" /></clipPath>
      <g clipPath={`url(#${id})`}>{BAR_VARS.map((c, i) => <rect key={c} x={6 + i * 4} y="6" width="4.2" height="28" />)}</g>
      <path d="M20 4v32M4 20h32" className="disc-cross" />
    </svg>
  );
}

/** "Back" chip at the top of inner pages. */
export const BackChip = ({ to = "/", children = "Back home" }: { to?: string; children?: ReactNode }) => (
  <Link to={to} className="chip"><Arrow dir="left" />{children}</Link>
);

/** Label / value pairs under a page title. */
export const Meta = ({ items }: { items: readonly (readonly [string, ReactNode])[] }) => (
  <dl className="meta">
    {items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);
