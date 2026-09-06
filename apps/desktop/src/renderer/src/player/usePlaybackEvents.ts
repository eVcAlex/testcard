import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { PlaybackEvent, PlaybackTrack } from "../../../shared/ipc.js";

/** What the picture well and transport bar render from. */
export type PlaybackState =
  | { readonly status: "idle" }
  | {
      readonly status: "loading";
      readonly channelId: string;
      readonly channelName: string;
      // mpv reports tracks a beat before the first frame; hold them so they're ready the
      // instant we flip to "playing" rather than arriving as an empty dropdown.
      readonly tracks: readonly PlaybackTrack[];
    }
  | {
      readonly status: "playing";
      readonly channelId: string;
      readonly channelName: string;
      readonly tracks: readonly PlaybackTrack[];
    }
  | {
      readonly status: "dead";
      readonly channelId: string;
      readonly channelName: string;
      readonly reason: "timeout" | "error";
      readonly message?: string;
    };

const IDLE: PlaybackState = { status: "idle" };

function reduce(state: PlaybackState, event: PlaybackEvent | { type: "optimistic-load"; channelId: string; channelName: string }): PlaybackState {
  switch (event.type) {
    case "optimistic-load":
    case "loading": {
      const keepTracks =
        (state.status === "loading" || state.status === "playing") && state.channelId === event.channelId
          ? state.tracks
          : [];
      return { status: "loading", channelId: event.channelId, channelName: event.channelName, tracks: keepTracks };
    }
    case "playing":
      return {
        status: "playing",
        channelId: event.channelId,
        channelName: currentName(state, event.channelId),
        tracks:
          (state.status === "loading" || state.status === "playing") && state.channelId === event.channelId
            ? state.tracks
            : [],
      };
    case "tracks":
      if ((state.status !== "playing" && state.status !== "loading") || state.channelId !== event.channelId) return state;
      return { ...state, tracks: event.tracks };
    case "timeout":
    case "error":
      return {
        status: "dead",
        channelId: event.channelId,
        channelName: currentName(state, event.channelId),
        reason: event.type,
        ...(event.type === "error" ? { message: event.message } : {}),
      };
    case "stopped":
      return IDLE;
    default:
      return state;
  }
}

function currentName(state: PlaybackState, channelId: string): string {
  return state.status !== "idle" && state.channelId === channelId ? state.channelName : "";
}

export function usePlaybackEvents() {
  const [state, dispatch] = useReducer(reduce, IDLE);

  useEffect(() => {
    // Guard against a dev-only window: an HMR renderer reload can briefly run against a
    // preload that hasn't re-injected yet. A full `pnpm dev` restart always has it.
    if (!window.testcard?.events) {
      console.warn("preload bridge not ready — restart `pnpm dev`");
      return;
    }
    return window.testcard.events.onPlayback((event) => dispatch(event));
  }, []);

  const play = useCallback((channelId: string, channelName: string) => {
    dispatch({ type: "optimistic-load", channelId, channelName });
    void window.testcard.playback.play(channelId).catch((error: unknown) => {
      dispatch({ type: "error", channelId, message: error instanceof Error ? error.message : "Playback failed to start." });
    });
  }, []);

  const retry = useCallback(() => {
    if (state.status === "dead") play(state.channelId, state.channelName);
  }, [state, play]);

  const audioTracks = useMemo(
    () => (state.status === "playing" ? state.tracks.filter((t) => t.type === "audio") : []),
    [state],
  );
  const subtitleTracks = useMemo(
    () => (state.status === "playing" ? state.tracks.filter((t) => t.type === "sub") : []),
    [state],
  );
  const formatLine = useMemo(() => (state.status === "playing" ? describeFormat(state.tracks) : ""), [state]);

  return { state, play, retry, audioTracks, subtitleTracks, formatLine };
}

function describeFormat(tracks: readonly PlaybackTrack[]): string {
  const parts: string[] = [];
  const video = tracks.find((t) => t.type === "video" && t.selected) ?? tracks.find((t) => t.type === "video");
  const audio = tracks.find((t) => t.type === "audio" && t.selected) ?? tracks.find((t) => t.type === "audio");
  if (video?.codec) parts.push(video.codec);
  if (audio?.codec) parts.push(audio.codec);
  return parts.join(" · ");
}
