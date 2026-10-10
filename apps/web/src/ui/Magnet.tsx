// Adapted from React Bits Magnet (https://reactbits.dev/animations/magnet): the child is pulled toward the pointer when
// it comes close. Typed, it only listens to a fine pointer, and it moves the element through the CSSOM rather than a
// style attribute (the site's CSP forbids inline styles).
import { type ReactNode, useEffect, useRef } from "react";

interface Props {
  children: ReactNode;
  padding?: number;
  strength?: number;
  disabled?: boolean;
  className?: string;
}

/** Keep the pull inside the pill's own padding so the button never pokes out of its container. */
const clamp = (v: number) => Math.max(-4, Math.min(4, v));

export function Magnet({ children, padding = 40, strength = 5, disabled = false, className = "" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const move = (e: PointerEvent) => {
      const el = box.current;
      const to = inner.current;
      if (!el || !to) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const near = Math.abs(cx - e.clientX) < r.width / 2 + padding && Math.abs(cy - e.clientY) < r.height / 2 + padding;
      to.classList.toggle("is-near", near);
      to.style.transform = near ? `translate3d(${clamp((e.clientX - cx) / strength)}px, ${clamp((e.clientY - cy) / strength)}px, 0)` : "";
    };
    // The pointer leaving the window sends no more moves, so settle the button back by hand.
    const settle = () => { inner.current?.classList.remove("is-near"); if (inner.current) inner.current.style.transform = ""; };
    addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", settle);
    addEventListener("blur", settle);
    return () => { removeEventListener("pointermove", move); document.documentElement.removeEventListener("pointerleave", settle); removeEventListener("blur", settle); };
  }, [padding, strength, disabled]);

  return (
    <div ref={box} className={`mag ${className}`.trim()}>
      <div ref={inner} className="mag-in">{children}</div>
    </div>
  );
}
