import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FeedHealth, Reconnects } from "./health.ts";
import { Icon } from "./Icon.tsx";
import { viaProxy } from "./proxy.ts";
import { nowAndNext, type Programme } from "./xtream.ts";

/** One thing to play: a film or episode (one address), or a live channel with its other feeds. */
export interface Feed {
  readonly name: string;
  readonly urls: readonly string[];
}
export interface PlayRequest {
  readonly title: string;
  readonly live: boolean;
  readonly feeds: readonly Feed[];
  /** Where to pick up a film or episode, in seconds. */
  readonly resumeAt?: number;
  /** Called once when it first plays (it goes to the top of Recent). */
  readonly onStart?: () => void;
  /** Called as a film or episode plays, and when it is left, with where it is up to. */
  readonly onPlace?: (position: number, duration: number | null) => void;
  /** What is on a live channel now and next. */
  readonly guide?: () => Promise<Programme[]>;
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

/** What the provider really answered, for a stream the browser could only call a "format error". */
async function whyNot(source: string): Promise<string | undefined> {
  try {
    const response = await fetch(source, { headers: { range: "bytes=0-0" } });
    await response.body?.cancel();
    if (response.status === 401) return "You were signed out. Sign in again.";
    if (response.status === 403) return "The provider refused this stream (403). Some providers block web players; the app may still play it.";
    if (response.status === 404) return "The provider does not have this stream (404).";
    if (response.status === 429) return "Today's streaming allowance on the web player is used up.";
    if (response.status >= 400) return `The provider answered ${response.status}.`;
  } catch {
    // Offline or blocked: the browser's own message stands.
  }
  return undefined;
}

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
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [started, setStarted] = useState(false);
  const [idle, setIdle] = useState(false);
  const reconnects = useMemo(() => new Reconnects(() => Date.now()), []);
  const quiet = useRef(false);
  const resumeFrom = useRef<number | undefined>(undefined);
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
    // A quiet reconnect keeps the picture's frame and shows no "Tuning..." over it.
    const reconnecting = quiet.current;
    quiet.current = false;
    setError(undefined);
    if (!reconnecting) setStarted(false);
    let played = false;
    /** The stream was lost: if it had been playing, pick it up again without a word; otherwise move on or fail. */
    const lost = (why: string) => {
      if (gone) return;
      if (played && reconnects.take()) {
        quiet.current = true;
        if (!request.live && element.currentTime > 5) resumeFrom.current = element.currentTime;
        setAttempt((value) => value + 1);
      } else next(why);
    };
    const source = viaProxy(current.url);
    const kind = kindOf(current.url);

    let said = false;
    const onPlaying = () => {
      health.onPlaying();
      reconnects.onPlaying();
      played = true;
      setStarted(true);
      if (said) return;
      said = true;
      request.onStart?.();
      const first = request.feeds[0];
      const now = request.feeds[current.feedIndex];
      if (at > 0 && first !== undefined && now !== undefined) setFellBack(now.name !== first.name ? `Playing ${now.name} instead` : "Playing a backup feed instead");
    };
    const onWaiting = () => health.onWaiting();
    const onFail = () => {
      if (played) return lost(element.error?.message || "The stream stopped.");
      if (health.onError() === "failover") next("");
      else {
        const browser = element.error?.message || "This could not be played.";
        void whyNot(source).then((why) => next(why ?? browser));
      }
    };
    element.addEventListener("playing", onPlaying);
    element.addEventListener("waiting", onWaiting);
    element.addEventListener("error", onFail);
    const tick = setInterval(() => {
      if (health.tick() === "failover") next("");
    }, 500);

    // A film or episode picks up where it was left, and keeps its place as it plays.
    let saved: ReturnType<typeof setInterval> | undefined;
    const keep = () => {
      if (!request.live && element.currentTime > 5) request.onPlace?.(element.currentTime, Number.isFinite(element.duration) ? element.duration : null);
    };
    if (!request.live) {
      const place = resumeFrom.current ?? request.resumeAt;
      if (place !== undefined && place > 5) element.addEventListener("loadedmetadata", () => (element.currentTime = place), { once: true });
      saved = setInterval(() => !element.paused && keep(), 10_000);
      element.addEventListener("pause", keep);
    }

    const start = async () => {
      try {
        // The players are loaded only when a stream needs one; each is large.
        const Hls = kind === "hls" && !isApple() ? (await import("hls.js")).default : undefined;
        if (gone) return;
        if (Hls !== undefined && Hls.isSupported()) {
          const hls = new Hls({ lowLatencyMode: false });
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) lost(`The stream stopped (${data.details}).`);
          });
          hls.loadSource(source);
          hls.attachMedia(element);
          stop = () => hls.destroy();
        } else if (kind === "ts") {
          const mpegts = (await import("mpegts.js")).default;
          if (gone) return;
          if (!mpegts.isSupported()) return next("This browser cannot play this kind of stream.");
          const player = mpegts.createPlayer({ type: "mpegts", isLive: true, url: source });
          player.on(mpegts.Events.ERROR, () => lost("The stream stopped."));
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
      keep();
      element.removeEventListener("pause", keep);
      element.removeEventListener("playing", onPlaying);
      element.removeEventListener("waiting", onWaiting);
      element.removeEventListener("error", onFail);
      stop();
    };
  }, [at, attempt, candidates, current, request, reconnects]);

  useEffect(() => {
    if (!request.live || request.guide === undefined) return;
    let gone = false;
    const load = () => request.guide?.().then((list) => !gone && setProgrammes(list), () => undefined);
    void load();
    const again = setInterval(load, 5 * 60_000);
    return () => {
      gone = true;
      clearInterval(again);
    };
  }, [request]);

  useEffect(() => {
    if (fellBack === undefined) return;
    const timer = setTimeout(() => setFellBack(undefined), 5000);
    return () => clearTimeout(timer);
  }, [fellBack]);

  // The top bar fades after a few seconds without the pointer moving, so it never sits over the picture.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 3500);
    };
    wake();
    for (const name of ["mousemove", "touchstart", "keydown"]) addEventListener(name, wake, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const name of ["mousemove", "touchstart", "keydown"]) removeEventListener(name, wake);
    };
  }, []);

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

  const { now, next } = nowAndNext(programmes, Date.now());
  const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div class={`player${idle && started && error === undefined ? " idle" : ""}`}>
      <video ref={video} controls autoplay playsinline />
      <div class="player-top">
        <button class="btn" onClick={onClose} aria-label="Close player"><Icon name="back" />Close</button>
        {request.live ? <span class="pill pill--live">LIVE</span> : null}
        <strong>{request.title}</strong>
        {request.live && candidates.length > 1 ? (
          <label class="switch">
            <input type="checkbox" checked={switchOn} onChange={toggleSwitch} /> Switch feed when it buffers
          </label>
        ) : null}
        {now !== undefined ? <div class="guide">Now: {now.title} (until {clock(now.end)}){next !== undefined ? ` · Next: ${next.title} at ${clock(next.start)}` : ""}</div> : null}
      </div>
      {!started && error === undefined ? <div class="player-wait"><div class="spinner" /><span>Tuning...</span></div> : null}
      {fellBack !== undefined ? <div class="player-note">That feed wouldn't play. {fellBack}.</div> : null}
      {error !== undefined ? (
        <div class="player-error">
          <Icon name="signal" size={32} />
          <p>{error}</p>
          <div class="row">
            <button class="btn btn--primary" onClick={retry}><Icon name="refresh" />Try again</button>
            <button class="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
