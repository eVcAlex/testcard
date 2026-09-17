import { useEffect, useReducer, useState } from "react";
import { Icon } from "../components/Icon.js";
import { useOverlayVisibility } from "./useOverlayVisibility.js";
import type { AspectMode, PlaybackEvent, PlaybackTrack } from "../../../shared/ipc.js";

interface OverlayState {
  readonly status: "idle" | "loading" | "playing" | "dead";
  readonly channelName: string;
  readonly paused: boolean;
  readonly volume: number;
  readonly aspect: AspectMode;
  readonly fullscreen: boolean;
  readonly tracks: readonly PlaybackTrack[];
}

const INITIAL: OverlayState = {
  status: "idle",
  channelName: "",
  paused: false,
  volume: 100,
  aspect: "fit",
  fullscreen: false,
  tracks: [],
};

const ASPECT_ORDER: readonly AspectMode[] = ["fit", "fill", "16:9", "4:3"];
const ASPECT_LABEL: Record<AspectMode, string> = { fit: "FIT", fill: "FILL", "16:9": "16:9", "4:3": "4:3" };

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
    case "aspect":
      return { ...state, aspect: event.aspect };
    case "fullscreen":
      return { ...state, fullscreen: event.fullscreen };
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

const api = () => window.testcard;

/**
 * The on-video transport overlay, over the video in both windowed and fullscreen mode (HTML
 * can't composite over mpv — ADR 0002). Renders playback state pushed from main. The window is
 * interactive; `.ov-root` is a transparent catch layer that reveals the bar on movement —
 * clicks land on the controls or on dead space (overlay.css).
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
      dispatch({ type: "aspect", aspect: snap.aspect });
      dispatch({ type: "fullscreen", fullscreen: snap.fullscreen });
    });

    return window.testcard.events.onPlayback((event) => dispatch(event));
  }, []);

  // Keep the bar up while the pointer is actually on it or holding a control (a stationary
  // hover and a slider drag emit no mousemove, so movement alone isn't enough — see the hook).
  const [hovering, setHovering] = useState(false);
  const [pressing, setPressing] = useState(false);
  const { revealed, bump } = useOverlayVisibility(state.paused || hovering || pressing);

  useEffect(() => {
    if (!pressing) return;
    const release = () => setPressing(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [pressing]);

  if (state.status !== "playing" && state.status !== "loading") return null;

  const subtitleTracks = state.tracks.filter((t) => t.type === "sub");
  const subOn = subtitleTracks.some((t) => t.selected);
  const audioTracks = state.tracks.filter((t) => t.type === "audio");
  const currentAudio = audioTracks.find((t) => t.selected) ?? audioTracks[0];
  const fmt = formatLine(state.tracks);
  const togglePause = () => void api().playback.setPaused(!state.paused);
  const toggleSubtitles = () => {
    const first = subtitleTracks[0];
    void api().playback.setSubtitleTrack(subOn || !first ? null : first.id);
  };
  const cycleAudio = () => {
    if (audioTracks.length < 2) return;
    const i = audioTracks.findIndex((t) => t.id === currentAudio?.id);
    const next = audioTracks[(i + 1) % audioTracks.length];
    if (next) void api().playback.setAudioTrack(next.id);
  };
  const cycleAspect = () => {
    const i = ASPECT_ORDER.indexOf(state.aspect);
    const next = ASPECT_ORDER[(i + 1) % ASPECT_ORDER.length];
    if (next) void api().playback.setAspect(next);
  };

  return (
    <div className="ov-root" data-revealed={revealed} onMouseMove={bump}>
      {state.paused && (
        <button type="button" className="ov-center" aria-label="Play" onClick={togglePause}>
          <Icon name="play" size={30} />
        </button>
      )}

      <div
        className="ov-bar"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onPointerDown={() => setPressing(true)}
      >
        <button
          type="button"
          className="ov-btn ov-btn--ghost"
          aria-label="Back to channels"
          onClick={() => void api().playback.exitPlayer()}
        >
          <Icon name="back" size={18} />
        </button>

        <button
          type="button"
          className="ov-btn ov-btn--ghost"
          aria-label="Previous channel"
          onClick={() => void api().playback.channelStep(-1)}
        >
          <Icon name="skip-back" size={18} />
        </button>

        <button
          type="button"
          className="ov-btn"
          aria-label={state.paused ? "Play" : "Pause"}
          onClick={togglePause}
        >
          <Icon name={state.paused ? "play" : "pause"} size={18} />
        </button>

        <button
          type="button"
          className="ov-btn ov-btn--ghost"
          aria-label="Next channel"
          onClick={() => void api().playback.channelStep(1)}
        >
          <Icon name="skip-forward" size={18} />
        </button>

        <div className="ov-vol">
          <Icon name={state.volume === 0 ? "volume-x" : "volume"} size={16} />
          <input
            type="range"
            min={0}
            max={130}
            value={state.volume}
            aria-label="Volume"
            onChange={(event) => void api().playback.setVolume(Number(event.target.value))}
          />
        </div>

        <div className="ov-id">
          <span className="ov-name">{state.channelName || "—"}</span>
          {fmt && <span className="ov-fmt tnum">{fmt}</span>}
        </div>

        <span className="ov-live" data-live={state.status === "playing"}>
          {state.status === "playing" ? "LIVE" : "TUNING"}
        </span>

        {audioTracks.length > 1 && (
          <button
            type="button"
            className="ov-btn ov-btn--ghost ov-audio"
            aria-label={`Audio track: ${currentAudio?.label ?? ""}. Switch`}
            onClick={cycleAudio}
          >
            {(currentAudio?.label ?? "AUD").split(" · ")[0]}
          </button>
        )}

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

        <button
          type="button"
          className="ov-btn ov-btn--ghost ov-aspect"
          aria-label={`Aspect ratio: ${ASPECT_LABEL[state.aspect]}. Change`}
          onClick={cycleAspect}
        >
          {ASPECT_LABEL[state.aspect]}
        </button>

        <button
          type="button"
          className="ov-btn ov-btn--ghost"
          aria-label={state.fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => void api().view.toggleFullscreen()}
        >
          <Icon name={state.fullscreen ? "fullscreen-exit" : "fullscreen"} size={18} />
        </button>
      </div>
    </div>
  );
}
