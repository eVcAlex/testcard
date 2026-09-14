import { useCallback, useEffect, useRef, useState } from "react";

const IDLE_MS = 3000;

/**
 * revealed | hidden, driven by forwarded pointer movement. `locked` (paused, or a menu open)
 * pins it revealed. The window itself stays shown while playing — only the bar fades — so
 * there are no window show/hide races to manage here (see ADR 0002).
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
