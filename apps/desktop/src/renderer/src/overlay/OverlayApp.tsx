import { useEffect, useReducer } from "react";
import { Icon } from "../components/Icon.js";
import { useOverlayVisibility } from "./useOverlayVisibility.js";
import type { PlaybackEvent, PlaybackTrack } from "../../../shared/ipc.js";

interface OverlayState {
  readonly status: "idle" | "loading" | "playing" | "dead";
  readonly channelName: string;
  readonly paused: boolean;
  readonly volume: number;
  readonly tracks: readonly PlaybackTrack[];
}

const INITIAL: OverlayState = {
  status: "idle",
  channelName: "",
  paused: false,
  volume: 100,
  tracks: [],
};

function reduce(state: OverlayState, event: PlaybackEvent): OverlayState {
  switch (event.type) {
    case "loading":
      return { ...state, status: "loading", channelName: event.channelName, tracks: [] };
    case "playing":
      return { ...state, status: "playing" };
    case "tracks":
      return { ...state, tracks: event.tracks };
    case "timeout":
    case "error":
      return { ...state, status: "dead" };
    case "paused":
      return { ...state, paused: event.paused };
    case "volume":
      return { ...state, volume: event.volume };
    case "stopped":
      return INITIAL;
    default:
      return state;
  }
}

function formatLine(tracks: readonly PlaybackTrack[]): string {
  const video = tracks.find((t) => t.type === "video" && t.selected) ?? tracks.find((t) => t.type === "video");
  const audio = tracks.find((t) => t.type === "audio" && t.selected) ?? tracks.find((t) => t.type === "audio");
  return [video?.codec, audio?.codec].filter(Boolean).join(" · ");
}

/**
 * The on-video transport overlay, shown only in fullscreen. Renders playback state pushed from
 * main and mirrors the docked control strip: exit-fullscreen, play/pause, volume, now-playing,
 * LIVE, subtitle toggle. The window is interactive; `.ov-root` is a transparent catch layer
 * that reveals the bar on movement — clicks land on the controls or on dead space (overlay.css).
 */
export function OverlayApp() {
  const [state, dispatch] = useReducer(reduce, INITIAL);

  useEffect(() => {
    if (!window.testcard?.events) return;

    void window.testcard.playback.snapshot().then((snap) => {
      if (snap.channelName) {
        dispatch({ type: "loading", channelId: snap.channelId ?? "", channelName: snap.channelName });
      }
      if (snap.status === "playing") dispatch({ type: "playing", channelId: snap.channelId ?? "" });
      if (snap.tracks.length > 0) {
        dispatch({ type: "tracks", channelId: snap.channelId ?? "", tracks: snap.tracks });
      }
      dispatch({ type: "paused", paused: snap.paused });
      dispatch({ type: "volume", volume: snap.volume });
    });

    return window.testcard.events.onPlayback((event) => dispatch(event));
  }, []);

  const { revealed, bump } = useOverlayVisibility(state.paused);

  if (state.status !== "playing" && state.status !== "loading") return null;

  const subtitleTracks = state.tracks.filter((t) => t.type === "sub");
  const subOn = subtitleTracks.some((t) => t.selected);
  const fmt = formatLine(state.tracks);
  const togglePause = () => void window.testcard.playback.setPaused(!state.paused);
  const toggleSubtitles = () => {
    const first = subtitleTracks[0];
    void window.testcard.playback.setSubtitleTrack(subOn || !first ? null : first.id);
  };

  return (
    <div className="ov-root" data-revealed={revealed} onMouseMove={bump} onMouseLeave={() => bump()}>
      {state.paused && (
        <button type="button" className="ov-center" aria-label="Play" onClick={togglePause}>
          <Icon name="play" size={30} />
        </button>
      )}

      <div className="ov-bar">
        <button
          type="button"
          className="ov-btn ov-btn--ghost"
          aria-label="Exit fullscreen"
          onClick={() => void window.testcard.view.toggleFullscreen()}
        >
          <Icon name="fullscreen-exit" size={18} />
        </button>

        <button
          type="button"
          className="ov-btn"
          aria-label={state.paused ? "Play" : "Pause"}
          onClick={togglePause}
        >
          <Icon name={state.paused ? "play" : "pause"} size={18} />
        </button>

        <div className="ov-vol">
          <Icon name={state.volume === 0 ? "volume-x" : "volume"} size={16} />
          <input
            type="range"
            min={0}
            max={130}
            value={state.volume}
            aria-label="Volume"
            onChange={(event) => void window.testcard.playback.setVolume(Number(event.target.value))}
          />
        </div>

        <div className="ov-id">
          <span className="ov-name">{state.channelName || "—"}</span>
          {fmt && <span className="ov-fmt tnum">{fmt}</span>}
        </div>

        <span className="ov-live" data-live={state.status === "playing"}>
          {state.status === "playing" ? "LIVE" : "TUNING"}
        </span>

        {subtitleTracks.length > 0 && (
          <button
            type="button"
            className="ov-btn ov-btn--ghost"
            data-on={subOn}
            aria-label={subOn ? "Subtitles off" : "Subtitles on"}
            onClick={toggleSubtitles}
          >
            <Icon name="cc" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
