/** Seven desaturated bars, left to right: white, yellow, cyan, green, magenta, red, blue. Decorative. */
export function ColourBars({ tall = false }: { tall?: boolean }) {
  return (
    <span className={tall ? "bars bars-tall" : "bars"} aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => <i key={i} />)}
    </span>
  );
}
