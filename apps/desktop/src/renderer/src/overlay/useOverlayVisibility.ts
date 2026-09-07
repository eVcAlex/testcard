import { useCallback, useEffect, useRef, useState } from "react";

const IDLE_MS = 3000;

/**
 * revealed | hidden, driven by pointer movement over the picture. `locked` pins it revealed —
 * the caller passes `paused || hovering the bar || holding a control`, since a stationary hover
 * and a slider drag produce no mousemove. When `locked` clears, the 3 s idle countdown
 * restarts. The window itself stays shown while playing — only the bar fades (see ADR 0002).
 */
export function useOverlayVisibility(locked: boolean): { revealed: boolean; bump: () => void } {
  const [revealed, setRevealed] = useState(true);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const bump = useCallback(() => {
    setRevealed(true);
    clear();
    timer.current = window.setTimeout(() => setRevealed(false), IDLE_MS);
  }, []);

  useEffect(() => {
    if (locked) {
      setRevealed(true);
      clear();
      return;
    }
    bump();
    return clear;
  }, [locked, bump]);

  return { revealed: revealed || locked, bump };
}
