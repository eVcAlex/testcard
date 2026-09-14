import { useCallback, useEffect, useState } from "react";

/**
 * OS fullscreen state for the main window. Toggled here or from the OS (F11, the title-bar
 * button, Esc); main pushes every change back as a `fullscreen` playback event, so this stays
 * correct however it was triggered.
 */
export function useFullscreen(): { fullscreen: boolean; toggle: () => void } {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!window.testcard?.events) return;
    void window.testcard.view.isFullscreen().then(setFullscreen);
    return window.testcard.events.onPlayback((event) => {
      if (event.type === "fullscreen") setFullscreen(event.fullscreen);
    });
  }, []);

  const toggle = useCallback(() => void window.testcard.view.toggleFullscreen(), []);

  return { fullscreen, toggle };
}
