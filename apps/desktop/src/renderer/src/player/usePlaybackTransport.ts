import { useCallback, useEffect, useState } from "react";

/**
 * paused / volume as owned by the main process (see PlaybackController). Pulls a snapshot on
 * mount — the player view can open after playback is already running — then follows the
 * `paused` / `volume` events. Setters update optimistically and echo through main.
 *
 * A separate `events.onPlayback` subscription from usePlaybackEvents; the preload bridge
 * supports multiple listeners, and keeping transport state out of that reducer keeps both
 * simple.
 */
export function usePlaybackTransport(): {
  paused: boolean;
  volume: number;
  setPaused: (paused: boolean) => void;
  setVolume: (volume: number) => void;
} {
  const [paused, setPausedState] = useState(false);
  const [volume, setVolumeState] = useState(100);

  useEffect(() => {
    if (!window.testcard?.events) return;

    let cancelled = false;
    void window.testcard.playback.snapshot().then((snap) => {
      if (cancelled) return;
      setPausedState(snap.paused);
      setVolumeState(snap.volume);
    });

    const off = window.testcard.events.onPlayback((event) => {
      if (event.type === "paused") setPausedState(event.paused);
      else if (event.type === "volume") setVolumeState(event.volume);
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const setPaused = useCallback((next: boolean) => {
    setPausedState(next);
    void window.testcard.playback.setPaused(next);
  }, []);

  const setVolume = useCallback((next: number) => {
    setVolumeState(next);
    void window.testcard.playback.setVolume(next);
  }, []);

  return { paused, volume, setPaused, setVolume };
}
