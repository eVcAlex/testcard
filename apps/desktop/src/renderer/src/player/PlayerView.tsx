import { useEffect } from "react";
import { PictureWell } from "./PictureWell.js";
import { NoSignal } from "./NoSignal.js";
import { usePlaybackTransport } from "./usePlaybackTransport.js";
import { useFullscreen } from "./useFullscreen.js";
import type { PlaybackState } from "./usePlaybackEvents.js";

/**
 * The fullscreen player surface. The picture fills the window; all transport controls live in
 * the on-video overlay window (a separate transparent window — HTML can't composite over the
 * mpv surface, see ADR 0002). This component only renders the dead-channel plate and the
 * "tuning" hint, and owns the keyboard shortcuts (the overlay is not keyboard-reachable).
 */
export function PlayerView({
  state,
  vlcAvailable,
  onRetry,
  onBack,
  onStep,
}: {
  state: PlaybackState;
  vlcAvailable: boolean;
  onRetry: () => void;
  onBack: () => void;
  onStep: (delta: number) => void;
}) {
  const { paused, volume, setPaused, setVolume } = usePlaybackTransport();
  const { fullscreen, toggle: toggleFullscreen } = useFullscreen();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) {
        return;
      }
      switch (event.key) {
        case " ":
        case "k":
          event.preventDefault();
          setPaused(!paused);
          break;
        case "ArrowUp":
          event.preventDefault();
          onStep(1);
          break;
        case "ArrowDown":
          event.preventDefault();
          onStep(-1);
          break;
        case "ArrowRight":
          event.preventDefault();
          setVolume(Math.min(130, volume + 5));
          break;
        case "ArrowLeft":
          event.preventDefault();
          setVolume(Math.max(0, volume - 5));
          break;
        case "f":
        case "F11":
          event.preventDefault();
          toggleFullscreen();
          break;
        case "Escape":
          if (fullscreen) toggleFullscreen();
          else onBack();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, volume, fullscreen, setPaused, setVolume, toggleFullscreen, onBack, onStep]);

  const name = state.status === "idle" ? "" : state.channelName;

  return (
    <div className="pw-player">
      <PictureWell>
        {state.status === "dead" && (
          <NoSignal
            channelName={state.channelName}
            {...(state.message !== undefined ? { message: state.message } : {})}
            onRetry={onRetry}
            onOpenInVlc={() => window.testcard.playback.openInVlc()}
            vlcAvailable={vlcAvailable}
          />
        )}
        {state.status === "loading" && <div className="pw-idle-hint">Tuning {name}…</div>}
      </PictureWell>
    </div>
  );
}
