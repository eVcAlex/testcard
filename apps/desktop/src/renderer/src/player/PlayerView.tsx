import { useEffect } from "react";
import { PictureWell } from "./PictureWell.js";
import { NoSignal } from "./NoSignal.js";
import { Icon } from "../components/Icon.js";
import { usePlaybackTransport } from "./usePlaybackTransport.js";
import type { PlaybackState } from "./usePlaybackEvents.js";
import type { PlaybackTrack } from "../../../shared/ipc.js";

export function PlayerView({
  state,
  audioTracks,
  subtitleTracks,
  formatLine,
  vlcAvailable,
  onRetry,
  onBack,
}: {
  state: PlaybackState;
  audioTracks: readonly PlaybackTrack[];
  subtitleTracks: readonly PlaybackTrack[];
  formatLine: string;
  vlcAvailable: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const { paused, volume, setPaused, setVolume } = usePlaybackTransport();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const name = state.status === "idle" ? "" : state.channelName;
  const live = state.status === "playing";
  const dead = state.status === "dead";
  const controlsEnabled = live;

  return (
    <div className="pw-player">
      <PictureWell>
        {dead && (
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

      <div className="pw-controls" data-disabled={!controlsEnabled && !dead}>
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Back to channels" onClick={onBack}>
          <Icon name="back" />
        </button>

        <button
          type="button"
          className="btn btn--icon"
          aria-label={paused ? "Play" : "Pause"}
          disabled={!controlsEnabled}
          onClick={() => setPaused(!paused)}
        >
          <Icon name={paused ? "play" : "pause"} />
        </button>

        <div className="pw-ctl-group">
          <Icon name={volume === 0 ? "volume-x" : "volume"} size={15} />
          <input
            type="range"
            className="pw-vol"
            min={0}
            max={130}
            value={volume}
            aria-label="Volume"
            disabled={!controlsEnabled}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </div>

        <div className="pw-ctl-now">
          <span className="pw-ctl-name">{name || "No channel"}</span>
          <span className="pw-ctl-fmt">{formatLine || (dead ? "no signal" : "")}</span>
        </div>

        <span className="pw-live" data-live={live}>
          {live ? "LIVE" : state.status === "loading" ? "TUNING" : dead ? "NO SIGNAL" : "STANDBY"}
        </span>

        <div className="pw-ctl-group pushed">
          {audioTracks.length > 1 && (
            <select
              className="pw-select"
              aria-label="Audio track"
              defaultValue={audioTracks.find((t) => t.selected)?.id ?? audioTracks[0]?.id}
              onChange={(event) => void window.testcard.playback.setAudioTrack(Number(event.target.value))}
            >
              {audioTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.label}
                </option>
              ))}
            </select>
          )}
          <select
            className="pw-select"
            aria-label="Subtitles"
            disabled={!controlsEnabled}
            defaultValue={subtitleTracks.find((t) => t.selected)?.id ?? "off"}
            onChange={(event) => {
              const value = event.target.value;
              void window.testcard.playback.setSubtitleTrack(value === "off" ? null : Number(value));
            }}
          >
            <option value="off">Subtitles off</option>
            {subtitleTracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
