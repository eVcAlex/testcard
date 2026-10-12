import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FeedHealth } from "./health.ts";
import { viaProxy } from "./proxy.ts";

/** One thing to play: a film or episode (one address), or a live channel with its other feeds. */
export interface Feed {
  readonly name: string;
  readonly urls: readonly string[];
}
export interface PlayRequest {
  readonly title: string;
  readonly live: boolean;
  readonly feeds: readonly Feed[];
  /** Where a film's or episode's place is kept on this device. */
  readonly resumeKey?: string;
}

const SWITCH_KEY = "tc:switchOnBuffering";
const note = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the setting just does not stick.
  }
};

const isApple = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
type Kind = "hls" | "ts" | "file";
const kindOf = (address: string): Kind => {
  const path = (() => {
    try {
      return new URL(address).pathname.toLowerCase();
    } catch {
      return address.toLowerCase();
    }
  })();
  return /\.m3u8?$/.test(path) ? "hls" : path.endsWith(".ts") ? "ts" : "file";
};

/**
 * Fullscreen playback. A live channel tries each of its feeds in turn: the address that is best for a browser first, then
 * the same channel's other addresses and qualities. One that errors, never starts, or (switch on, the default) sits
 * buffering for a few seconds is moved on from, as on the Fire TV app.
 */
export function Player({ request, onClose }: { request: PlayRequest; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const candidates = useMemo(() => request.feeds.flatMap((feed, feedIndex) => feed.urls.map((url) => ({ url, feedIndex }))), [request]);
  const [at, setAt] = useState(0);
  const [error, setError] = useState<string>();
  const [fellBack, setFellBack] = useState<string>();
  const [switchOn, setSwitchOn] = useState(read(SWITCH_KEY) !== "0");
  const [attempt, setAttempt] = useState(0);
  const switchRef = useRef(switchOn);
  switchRef.current = switchOn;
  const current = candidates[at];

  useEffect(() => {
    const element = video.current;
    if (element === null || current === undefined) return;
    let gone = false;
    let stop = (): void => undefined;
    const health = new FeedHealth(() => Date.now(), request.live && at + 1 < candidates.length, () => switchRef.current);
    const next = (why: string) => {
      if (gone) return;
      if (request.live && at + 1 < candidates.length) setAt(at + 1);
      else setError(why);
    };
    setError(undefined);
    const source = viaProxy(current.url);
    const kind = kindOf(current.url);

    let said = false;
    const onPlaying = () => {
      health.onPlaying();
      if (said) return;
      said = true;
      const first = request.feeds[0];
      const now = request.feeds[current.feedIndex];
      if (at > 0 && first !== undefined && now !== undefined) setFellBack(now.name !== first.name ? `Playing ${now.name} instead` : "Playing a backup feed instead");
    };
    const onWaiting = () => health.onWaiting();
    const onFail = () => {
      if (health.onError() === "failover") next("");
      else next(element.error?.message || "This could not be played.");
    };
    element.addEventListener("playing", onPlaying);
    element.addEventListener("waiting", onWaiting);
    element.addEventListener("error", onFail);
    const tick = setInterval(() => {
      if (health.tick() === "failover") next("");
    }, 500);

    // A film or episode picks up where it was left.
    let saved: ReturnType<typeof setInterval> | undefined;
    if (!request.live && request.resumeKey !== undefined) {
      const key = `tc:pos:${request.resumeKey}`;
      const place = Number(read(key));
      if (place > 5) element.addEventListener("loadedmetadata", () => (element.currentTime = place), { once: true });
      saved = setInterval(() => {
        if (element.currentTime > 5 && !element.paused) write(key, String(Math.floor(element.currentTime)));
      }, 5000);
    }

    const start = async () => {
      try {
        // The players are loaded only when a stream needs one; each is large.
        const Hls = kind === "hls" && !isApple() ? (await import("hls.js")).default : undefined;
        if (gone) return;
        if (Hls !== undefined && Hls.isSupported()) {
          const hls = new Hls({ lowLatencyMode: false });
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) next(`The stream stopped (${data.details}).`);
          });
          hls.loadSource(source);
          hls.attachMedia(element);
          stop = () => hls.destroy();
        } else if (kind === "ts") {
          const mpegts = (await import("mpegts.js")).default;
          if (gone) return;
          if (!mpegts.isSupported()) return next("This browser cannot play this kind of stream.");
          const player = mpegts.createPlayer({ type: "mpegts", isLive: true, url: source });
          player.on(mpegts.Events.ERROR, () => next("The stream stopped."));
          player.attachMediaElement(element);
          player.load();
          stop = () => player.destroy();
        } else {
          element.src = source;
          stop = () => {
            element.removeAttribute("src");
            element.load();
          };
        }
        await element.play().catch(() => undefined);
      } catch (reason) {
        next(note(reason));
      }
    };
    void start();

    return () => {
      gone = true;
      clearInterval(tick);
      if (saved !== undefined) clearInterval(saved);
      element.removeEventListener("playing", onPlaying);
      element.removeEventListener("waiting", onWaiting);
      element.removeEventListener("error", onFail);
      stop();
    };
  }, [at, attempt, candidates, current, request]);

  useEffect(() => {
    if (fellBack === undefined) return;
    const timer = setTimeout(() => setFellBack(undefined), 5000);
    return () => clearTimeout(timer);
  }, [fellBack]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const retry = () => {
    setAt(0);
    setAttempt((value) => value + 1);
  };
  const toggleSwitch = () => {
    write(SWITCH_KEY, switchOn ? "0" : "1");
    setSwitchOn(!switchOn);
  };

  return (
    <div class="player">
      <video ref={video} controls autoplay playsinline />
      <div class="player-bar">
        <button class="quiet" onClick={onClose} aria-label="Close player">Close</button>
        <strong>{request.title}</strong>
        {request.live && candidates.length > 1 ? (
          <label class="switch">
            <input type="checkbox" checked={switchOn} onChange={toggleSwitch} /> Switch feed when it buffers
          </label>
        ) : null}
      </div>
      {fellBack !== undefined ? <div class="player-note">That feed wouldn't play. {fellBack}.</div> : null}
      {error !== undefined ? (
        <div class="player-error">
          <p>{error}</p>
          <button onClick={retry}>Try again</button> <button class="quiet" onClick={onClose}>Close</button>
        </div>
      ) : null}
    </div>
  );
}
