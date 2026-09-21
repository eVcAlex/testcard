import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, useTVEventHandler, View } from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { setPlaybackProgress } from "@testcard/core/src/db/progressQueries.js";
import { recordRecent } from "@testcard/core/src/db/queries.js";
import { recordMovieRecent } from "@testcard/core/src/db/vodQueries.js";
import { findNextEpisode, getSkipWindow, recordSeriesRecent, saveSkipWindow } from "@testcard/core/src/db/seriesQueries.js";
import type { CatchupProgramme } from "@testcard/core/src/source/xtream/catchup.js";
import { playerTitle } from "../ui/titles";
import { channelVariantIds, resolveStream, type PlayItem, type ResolvedStream } from "../playback/resolveStream";
import { useApp } from "../state/app";
import { colors, space, type, styleSheet, uiScale } from "../theme";
import { Button } from "../ui/controls";
import { streamFacts } from "../playback/streamInfo";
import { channelCatchup, loadCatchupGuide, type CatchupGuide } from "../playback/catchup";
import { fetchGuide, type Airing } from "../playback/airing";

const SEEK_STEP_SECS = 10;
/** Presses in a row (each within this of the last) reach further: 10 s, then 30 s, 1 min, 2 min. */
const STREAK_WITHIN_MS = 600;
const stepForStreak = (count: number) => (count < 2 ? SEEK_STEP_SECS : count < 4 ? 30 : count < 7 ? 60 : 120);
const CHROME_HIDES_AFTER_MS = 4000;
/** A live picture stuck refilling this long is reloaded, at most this many times. */
const STUCK_AFTER_MS = 12_000;
const MAX_RELOADS = 4;
/** The last stretch of an episode, when the next one is offered: about where the credits start. */
const NEXT_WINDOW_SECS = 40;
/** After an episode ends, the next one starts by itself this many seconds later unless a key is pressed. */
const AUTO_NEXT_SECS = 8;
/** Stepping to another channel remounts the player, so the highlighted control is carried across, and spamming next or previous keeps working. */
let carriedSelection: Control | undefined;
/** The channel being watched and the one before it, kept across channel changes so "Last" can flip back, as on a TV remote. */
let channelHistory: { current?: PlayItem; previous?: PlayItem } = {};
const PROGRESS_EVERY_MS = 5000;

type Control = "exit" | "seek" | "back" | "play" | "forward" | "info" | "captions" | "next" | "last" | "live" | "catchup";

/** A length written in 1920 px design units, for the shapes below that are sized in code. */
const u = (n: number) => Math.round(n * uiScale);

/**
 * Fullscreen playback. On a TV remote: Left/Right seek, OK plays or pauses, Up/Down show the controls,
 * Back leaves. On a phone: tap the picture for the controls. Position is saved every few seconds so
 * "continue watching" and sync have something to carry.
 */
export function PlayerScreen({ item, seriesId, resume, channels, onZap, onNextEpisode, onExit }: { onNextEpisode?: ((episode: PlayItem) => void) | undefined; item: PlayItem; seriesId?: string; resume: boolean; channels?: readonly PlayItem[] | undefined; onZap?: ((channel: PlayItem) => void) | undefined; onExit: () => void }) {
  const { db, sync, updateStatus } = useApp();
  const [stream, setStream] = useState<ResolvedStream>();
  const [error, setError] = useState<string>();
  // A past programme the viewer picked from Catch up, for this channel only: changing channel goes back to live.
  const [picked, setPicked] = useState<{ channelId: string; programme: CatchupProgramme }>();
  const catchup = picked?.channelId === item.id ? picked.programme : undefined;
  // A live channel that will not play is tried again on its other feeds (another quality, a backup) before the viewer sees an error.
  const [variantAt, setVariantAt] = useState(0);
  const variantCount = useMemo(() => (item.kind === "channel" ? channelVariantIds(db, item.id).length : 1), [db, item]);
  const failOver = useCallback(() => setVariantAt((at) => at + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    resolveStream(db, item, resume, catchup, variantAt).then(
      (resolved) => !cancelled && setStream(resolved),
      (failure: unknown) => !cancelled && setError(failure instanceof Error ? failure.message : "This couldn't be played."),
    );
    return () => {
      cancelled = true;
    };
  }, [db, item, resume, catchup, variantAt]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onExit();
      return true;
    });
    return () => subscription.remove();
  }, [onExit]);

  if (error !== undefined) return <Failure title={item.title} message={error} onExit={onExit} />;
  if (stream === undefined) {
    return (
      <View style={styles.centre}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.muted}>Loading...</Text>
      </View>
    );
  }
  return (
    <Playing
      key={catchup === undefined ? "live" : catchup.serverStart}
      item={item}
      stream={stream}
      catchup={catchup}
      onCatchup={(programme) => setPicked(programme === undefined ? undefined : { channelId: item.id, programme })}
      channels={channels}
      onZap={onZap}
      onNextEpisode={onNextEpisode}
      moreFeeds={variantAt + 1 < variantCount}
      onFailOver={failOver}
      onExit={() => {
        sync.notifyLocalChange();
        updateStatus();
        onExit();
      }}
      {...(seriesId !== undefined ? { seriesId } : {})}
    />
  );
}

function Failure({ title, message, detail, onRetry, onExit }: { title: string; message: string; detail?: string; onRetry?: () => void; onExit: () => void }) {
  return (
    <View style={styles.centre}>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.error}>{message}</Text>
      {detail !== undefined && detail !== "" ? (
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
      <View style={styles.row}>
        {onRetry !== undefined ? <Button label="Try again" onPress={onRetry} /> : null}
        <Button preferred label="Back" onPress={onExit} />
      </View>
    </View>
  );
}

/** The device's decoder said no (a 4K or 10-bit stream on hardware that cannot do it) or the network did. */
function explain(raw: string): string {
  if (/EXCEEDS_CAPABILITIES|MediaCodec|Decoder|decoder/i.test(raw)) return "This device can't decode this video (its format or resolution is beyond the hardware).";
  if (/40[13]/.test(raw)) return "The provider refused this stream.";
  if (/404|410/.test(raw)) return "The provider has no stream at that address (it may have been removed).";
  if (/Unable to connect|timeout|timed out|Network|UnknownHost|ConnectException/i.test(raw)) return "Couldn't reach the stream. Check the connection and try again.";
  return "This couldn't be played.";
}

const two = (n: number) => String(n).padStart(2, "0");

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

const GUIDE_ROW = 64;
/** A live picture paused for longer than this has fallen behind the broadcast. */
const BEHIND_AFTER_MS = 2000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One line of the Catch up list: what to call the day, the start time and the programme. */
interface CatchupEntry {
  readonly programme: CatchupProgramme;
  readonly when: string;
  readonly time: string;
}

const hourMinute = (date: Date) => `${two(date.getHours())}:${two(date.getMinutes())}`;

function dayLabel(date: Date, now: Date): string {
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : (DAYS[date.getDay()] ?? "");
}

/** What is on now (to start over) comes first, then the past programmes, newest first. */
function catchupEntries(guide: CatchupGuide): CatchupEntry[] {
  const now = new Date();
  const past = guide.past.map((programme) => ({ programme, when: dayLabel(programme.start, now), time: hourMinute(programme.start) }));
  return guide.current === undefined ? past : [{ programme: guide.current, when: "Start over", time: hourMinute(guide.current.start) }, ...past];
}

function Playing({ item, stream, catchup, onCatchup, seriesId, channels, onZap, onNextEpisode, moreFeeds, onFailOver, onExit }: { onNextEpisode: ((episode: PlayItem) => void) | undefined; moreFeeds: boolean; onFailOver: () => void; item: PlayItem; stream: ResolvedStream; catchup: CatchupProgramme | undefined; onCatchup: (programme: CatchupProgramme | undefined) => void; seriesId?: string; channels: readonly PlayItem[] | undefined; onZap: ((channel: PlayItem) => void) | undefined; onExit: () => void }) {
  const { db } = useApp();
  const vod = item.kind !== "channel";
  const timeshift = catchup !== undefined;
  const started = useRef(false);

  const player = useVideoPlayer(stream.url, (instance) => {
    // Live has no bar to move, so it needs far fewer time updates (each one re-renders the screen).
    instance.timeUpdateEventInterval = vod ? 0.5 : 1;
    // Read well ahead so a provider hiccup is absorbed instead of stalling the picture. The byte cap keeps a
    // high-bitrate 4K stream from filling a small device's memory before the time target is reached.
    instance.bufferOptions = vod
      ? { preferredForwardBufferDuration: 40, minBufferForPlayback: 2.5, maxBufferBytes: 64 * 1024 * 1024 }
      : { preferredForwardBufferDuration: 60, minBufferForPlayback: 2.5, maxBufferBytes: 48 * 1024 * 1024 };
    if (stream.resumeSecs !== null) instance.currentTime = stream.resumeSecs;
    instance.play();
  });

  const { status, error } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { videoTrack } = useEvent(player, "videoTrackChange", { videoTrack: player.videoTrack });
  const facts = streamFacts(videoTrack);
  // Each time the picture stops to refill after it has started is one stall, shown in the info panel.
  const [stalls, setStalls] = useState(0);
  const everPlayed = useRef(false);
  useEffect(() => {
    if (status === "readyToPlay") everPlayed.current = true;
    else if (status === "loading" && everPlayed.current) setStalls((count) => count + 1);
  }, [status]);
  // Live TV: a picture that stays stuck refilling is asked for again from the start, a few times, before giving up.
  const reloads = useRef(0);
  useEffect(() => {
    if (vod || timeshift || status !== "loading" || !everPlayed.current || reloads.current >= MAX_RELOADS) return;
    const timer = setTimeout(() => {
      reloads.current += 1;
      player.replace(stream.url);
      player.play();
    }, STUCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [player, status, stream.url, timeshift, vod]);
  // A live channel that errors is tried on its next feed, if it has one.
  const failing = status === "error" && !vod && !timeshift && moreFeeds;
  useEffect(() => {
    if (failing) onFailOver();
  }, [failing, onFailOver]);

  // Live TV: pausing lets the picture fall behind the broadcast. Once it has, there is a way back to live.
  const [behindLive, setBehindLive] = useState(false);
  const pausedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (vod || timeshift) return;
    // Only a real pause counts: not the picture still starting up, and not a stall while it refills.
    if (!isPlaying && status === "readyToPlay" && everPlayed.current) pausedAt.current ??= Date.now();
    else if (isPlaying && pausedAt.current !== undefined) {
      if (Date.now() - pausedAt.current > BEHIND_AFTER_MS) setBehindLive(true);
      pausedAt.current = undefined;
    }
  }, [isPlaying, status, timeshift, vod]);
  const goLive = useCallback(() => {
    setBehindLive(false);
    pausedAt.current = undefined;
    player.replace(stream.url);
    player.play();
  }, [player, stream.url]);
  // Live TV: what is on now, for the programme bar. Asked once, then again when that programme ends.
  const [airing, setAiring] = useState<Airing | null>(null);
  useEffect(() => {
    if (vod || timeshift) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      fetchGuide(db, item.id).then(
        (guide) => {
          if (!live) return;
          const found = guide?.now ?? null;
          setAiring(found);
          timer = setTimeout(load, found !== null ? Math.min(30 * 60_000, Math.max(30_000, found.end - Date.now() + 2000)) : 5 * 60_000);
        },
        () => {
          if (live) timer = setTimeout(load, 5 * 60_000); // the bar works without the guide
        },
      );
    };
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [db, item.id, timeshift, vod]);
  const [statsOn, setStatsOn] = useState(false);
  // Captions the file carries: the key steps through them (off, then each track) and back to off.
  const tracks = useEvent(player, "availableSubtitleTracksChange", { availableSubtitleTracks: player.availableSubtitleTracks }).availableSubtitleTracks;
  const captionTrack = useEvent(player, "subtitleTrackChange", { subtitleTrack: player.subtitleTrack, oldSubtitleTrack: null }).subtitleTrack;
  const captionLabel = (track: (typeof tracks)[number] | null) => (track === null ? "Captions off" : `Captions: ${track.label !== "" ? track.label : track.language !== "" ? track.language : "on"}`);
  const cycleCaptions = useCallback(() => {
    const options = [null, ...tracks];
    const now = options.findIndex((track) => (track === null ? captionTrack === null : captionTrack !== null && track.id === captionTrack.id && track.label === captionTrack.label && track.language === captionTrack.language));
    player.subtitleTrack = options[(now + 1) % options.length] ?? null;
  }, [captionTrack, player, tracks]);
  const time = useEvent(player, "timeUpdate", { currentTime: player.currentTime, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: player.bufferedPosition });
  // Seeking moves the shown position straight away instead of waiting for the next time update.
  const [seekedTo, setSeekedTo] = useState<number>();
  useEffect(() => setSeekedTo(undefined), [time.currentTime]);
  const position = seekedTo ?? time.currentTime;
  const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0;
  // Progress is saved from these, not from the player: on leaving, the player is already released by the
  // time this component's cleanup runs, and touching it then throws.
  const latest = useRef({ position: 0, duration: 0 });
  latest.current = { position, duration };

  // An episode offers the next one near its end, and starts it by itself once it has finished unless a key is pressed.
  const next = useMemo(() => (item.kind === "episode" ? findNextEpisode(db, item.id) : undefined), [db, item]);
  const nearEnd = next !== undefined && onNextEpisode !== undefined && duration > 300 && position >= duration - NEXT_WINDOW_SECS;
  const finished = nearEnd && position >= duration - 0.5;
  // Skip intro: what the viewer last skipped at the start of this series is offered again where it starts in each episode.
  const skip = useMemo(() => (item.kind === "episode" && seriesId !== undefined ? getSkipWindow(db, seriesId) : undefined), [db, item, seriesId]);
  const inIntro = skip !== undefined && position >= skip.fromSecs - 3 && position < skip.toSecs - 2 && duration > skip.toSecs + 60;
  const [autoCancelled, setAutoCancelled] = useState(false);
  const [autoIn, setAutoIn] = useState(AUTO_NEXT_SECS);
  const goNext = useCallback(() => {
    if (next !== undefined) onNextEpisode?.({ kind: "episode", id: next.id, title: next.name });
  }, [next, onNextEpisode]);
  useEffect(() => {
    if (!finished || autoCancelled) return;
    setAutoIn(AUTO_NEXT_SECS);
    const timer = setInterval(() => setAutoIn((left) => left - 1), 1000);
    return () => clearInterval(timer);
  }, [autoCancelled, finished]);
  useEffect(() => {
    if (finished && !autoCancelled && autoIn <= 0) goNext();
  }, [autoCancelled, autoIn, finished, goNext]);

  // The controls fade out while playing and come back on any key, tap or pause.
  const [awake, setAwake] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = useCallback(() => {
    setAwake(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setAwake(false), CHROME_HIDES_AFTER_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => clearTimeout(hideTimer.current);
  }, [wake]);
  const chrome = awake || !isPlaying;
  // Back with the controls showing over a playing picture hides them; with them hidden (or paused, when they stay up) it leaves.
  const canHide = awake && isPlaying;
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: chrome ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [chrome, fade]);

  const [flash, setFlash] = useState<"back" | "forward" | "play">();
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pulse = useCallback((kind: "back" | "forward" | "play") => {
    setFlash(kind);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(undefined), 350);
  }, []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // A run of forward jumps near the start of an episode (the skip or fast-forward keys pressed in a row) is taken as skipping the
  // opening, and remembered for the series. Small nudges, or jumps later on, are not.
  const burst = useRef<{ from: number; to: number; timer?: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const noteJump = useCallback(
    (from: number, to: number) => {
      if (item.kind !== "episode" || seriesId === undefined) return;
      if (to <= from) {
        clearTimeout(burst.current?.timer);
        burst.current = undefined;
        return;
      }
      const run = burst.current ?? { from, to };
      run.to = to;
      burst.current = run;
      clearTimeout(run.timer);
      run.timer = setTimeout(() => {
        burst.current = undefined;
        if (run.from < 360 && run.to - run.from >= 40 && run.to < 720) saveSkipWindow(db, seriesId, run.from, run.to);
      }, 1800);
    },
    [db, item.kind, seriesId],
  );
  useEffect(() => () => clearTimeout(burst.current?.timer), []);
  const lastSeek = useRef({ at: 0, direction: 0, count: 0 });
  const seek = useCallback(
    (direction: 1 | -1) => {
      if (!vod) return;
      const now = Date.now();
      const streak = lastSeek.current.direction === direction && now - lastSeek.current.at < STREAK_WITHIN_MS ? lastSeek.current.count + 1 : 0;
      lastSeek.current = { at: now, direction, count: streak };
      const from = player.currentTime;
      const target = Math.min(duration > 0 ? duration - 1 : Infinity, Math.max(0, from + direction * stepForStreak(streak)));
      noteJump(from, target);
      player.currentTime = target;
      setSeekedTo(target);
      pulse(direction === 1 ? "forward" : "back");
      wake();
    },
    [duration, noteJump, player, pulse, vod, wake],
  );
  const skipIntro = useCallback(() => {
    if (skip === undefined) return;
    player.currentTime = skip.toSecs;
    setSeekedTo(skip.toSecs);
    pulse("forward");
    wake();
  }, [player, pulse, skip, wake]);
  // A tap or click on the progress bar jumps to that point.
  const [barWidth, setBarWidth] = useState(0);
  const seekToRatio = useCallback(
    (ratio: number) => {
      if (!vod || duration <= 0) return;
      const target = Math.min(duration - 1, Math.max(0, ratio * duration));
      player.currentTime = target;
      setSeekedTo(target);
      wake();
    },
    [duration, player, vod, wake],
  );
  // Live TV: step through the channels of the list the viewer came from.
  const at = channels !== undefined ? channels.findIndex((channel) => channel.id === item.id) : -1;
  const zapping = !vod && !timeshift && at >= 0 && channels !== undefined && channels.length > 1 && onZap !== undefined;
  const zap = useCallback(
    (direction: 1 | -1) => {
      if (!zapping || channels === undefined || onZap === undefined) return;
      const next = channels[(at + direction + channels.length) % channels.length];
      if (next !== undefined) onZap(next);
    },
    [at, channels, onZap, zapping],
  );
  const step = useCallback((direction: 1 | -1) => (vod ? seek(direction) : zap(direction)), [seek, vod, zap]);

  // Catch-up: when the provider keeps this channel's past programmes, the viewer can open the list and play one from its start.
  const archive = useMemo(() => (vod ? undefined : channelCatchup(db, item.id)), [db, item.id, vod]);
  const [guide, setGuide] = useState<{ state: "loading" } | { state: "failed" } | { state: "ready"; entries: CatchupEntry[] }>();
  const [guideAt, setGuideAt] = useState(0);
  const guideOpen = guide !== undefined;
  const openGuide = useCallback(() => {
    if (archive === undefined) return;
    setGuide({ state: "loading" });
    setGuideAt(0);
    loadCatchupGuide(archive).then(
      (loaded) => setGuide({ state: "ready", entries: catchupEntries(loaded) }),
      () => setGuide({ state: "failed" }),
    );
  }, [archive]);
  const playEntry = useCallback(
    (entry: CatchupEntry) => {
      setGuide(undefined);
      onCatchup(entry.programme);
    },
    [onCatchup],
  );
  useEffect(() => {
    if (!guideOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setGuide(undefined);
      return true;
    });
    return () => subscription.remove();
  }, [guideOpen]);
  useEffect(() => {
    if (!canHide || guideOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      clearTimeout(hideTimer.current);
      setAwake(false);
      return true;
    });
    return () => subscription.remove();
  }, [canHide, guideOpen]);
  const guideScroll = useRef<ScrollView>(null);
  useEffect(() => guideScroll.current?.scrollTo({ y: Math.max(0, guideAt - 3) * u(GUIDE_ROW), animated: false }), [guideAt]);
  const lastToggle = useRef(0);
  const togglePause = useCallback(() => {
    // One press of the remote's play/pause key can reach us twice, and the system's media session can act on the same
    // press after we have: the picture plays, then pauses straight away. So a second toggle this soon is ignored,
    // and a moment later the picture is put back where this press left it if something else moved it.
    const now = Date.now();
    if (now - lastToggle.current < 500) return;
    lastToggle.current = now;
    const wantPlaying = !player.playing;
    if (wantPlaying) player.play();
    else player.pause();
    setTimeout(() => {
      try {
        if (player.playing !== wantPlaying) {
          if (wantPlaying) player.play();
          else player.pause();
        }
      } catch {
        // The player was released in the meantime (the viewer left).
      }
    }, 350);
    pulse("play");
    wake();
  }, [player, pulse, wake]);

  // The D-pad drives a highlight (`selected`) over the controls: up/down change row, left/right change
  // control (or scrub, on the bar), OK presses. With the controls hidden, any key only brings them up, so a
  // stray press never skips. Films and episodes start on the bar, so left and right scrub straight away.
  // Live keeps up/down for changing channel, so its way out sits at the left end of the transport row.
  // Remember the channel; once there is an earlier one, a Last key flips back to it.
  if (item.kind === "channel" && !timeshift && channelHistory.current?.id !== item.id) channelHistory = { previous: channelHistory.current, current: item };
  const previousChannel = zapping ? channelHistory.previous : undefined;
  const more: Control[] = [...(previousChannel !== undefined ? (["last"] as const) : []), ...(archive !== undefined ? (["catchup"] as const) : [])];
  const captionsKey: Control[] = vod && tracks.length > 0 ? ["captions"] : [];
  const nextKey: Control[] = next !== undefined && onNextEpisode !== undefined ? ["next"] : [];
  const rows: Control[][] = vod ? [["exit"], ["seek"], ["back", "play", "forward", ...captionsKey, ...nextKey, "info"]] : zapping ? [["exit", "live", "back", "play", "forward", ...more]] : [["exit", "live", "play", ...more]];
  const [selected, setSelected] = useState<Control>(() => {
    const carried = carriedSelection;
    carriedSelection = undefined;
    return carried ?? (vod ? "seek" : "play");
  });
  const press = useCallback(
    (control: Control) => {
      if (control === "exit") onExit();
      else if (control === "back" || control === "forward") {
        if (zapping) carriedSelection = control;
        step(control === "back" ? -1 : 1);
      }
      else if (control === "info") setStatsOn((on) => !on);
      else if (control === "captions") cycleCaptions();
      else if (control === "next") goNext();
      else if (control === "last") {
        const previous = channelHistory.previous;
        if (previous !== undefined && onZap !== undefined) {
          carriedSelection = "last";
          onZap(previous);
        }
      }
      else if (control === "catchup") openGuide();
      else if (control === "live") (timeshift ? onCatchup(undefined) : behindLive ? goLive() : wake());
      else togglePause();
    },
    [behindLive, cycleCaptions, goLive, goNext, onCatchup, onExit, onZap, openGuide, step, timeshift, togglePause, wake, zapping],
  );
  // Android reports remote keys on release (eventKeyAction 1) and, unless key-down events are on, only then.
  useTVEventHandler(
    useCallback(
      (event: { eventType: string; eventKeyAction?: number | undefined }) => {
        if (event.eventKeyAction === 0) return; // a key-down duplicate, if key-down events are ever enabled
        const key = event.eventType;
        // While the next episode is on offer, OK plays it; any other key means the viewer is still here, so the automatic start is off.
        if (inIntro && key === "select" && (!chrome || selected === "seek" || selected === "play")) return skipIntro();
        if (nearEnd) {
          // OK on the bar or with the controls hidden means "yes, the next one"; on another control it does that control's job.
          if (key === "select" && (!chrome || selected === "seek" || selected === "play")) return goNext();
          setAutoCancelled(true);
        }
        if (guideOpen) {
          const count = guide.state === "ready" ? guide.entries.length : 0;
          if (key === "up" || key === "down") setGuideAt((at) => Math.min(Math.max(0, count - 1), Math.max(0, at + (key === "down" ? 1 : -1))));
          else if (key === "select" && guide.state === "ready") {
            const entry = guide.entries[guideAt];
            if (entry !== undefined) playEntry(entry);
          } else if (key === "left") setGuide(undefined);
          return;
        }
        if (key === "playPause") return togglePause();
        if (key === "rewind") return step(-1);
        if (key === "fastForward") return step(1);
        // Live: up and down change channel, as on any TV.
        if (zapping && (key === "up" || key === "down")) {
          wake();
          carriedSelection = selected;
          return zap(key === "down" ? 1 : -1);
        }
        if (!chrome) {
          // Any key brings the controls up; pausing is the play key's job.
          setSelected(vod ? "seek" : "play");
          return wake();
        }
        wake();
        const row = rows.findIndex((r) => r.includes(selected));
        if (key === "up" || key === "down") {
          const next = rows[Math.min(rows.length - 1, Math.max(0, row + (key === "down" ? 1 : -1)))];
          if (next !== undefined) setSelected(next.includes("play") ? "play" : (next[0] as Control));
        } else if (key === "left" || key === "right") {
          if (selected === "seek") return seek(key === "right" ? 1 : -1);
          const controls = rows[row] ?? [];
          const at = controls.indexOf(selected);
          const next = controls[Math.min(controls.length - 1, Math.max(0, at + (key === "right" ? 1 : -1)))];
          if (next !== undefined) setSelected(next);
        } else if (key === "select") {
          press(selected);
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [chrome, goNext, guide, guideAt, guideOpen, inIntro, nearEnd, playEntry, skipIntro, press, selected, seek, step, togglePause, vod, wake, zap, zapping],
    ),
  );

  // Recents on first play; progress every few seconds for films and episodes.
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      if (item.kind === "channel") {
        if (!timeshift) recordRecent(db, item.id);
      }
      else if (item.kind === "movie") recordMovieRecent(db, item.id);
      else if (seriesId !== undefined) recordSeriesRecent(db, seriesId);
    }
    if (!vod) return;
    const save = () => {
      const { position: at, duration: length } = latest.current;
      // No known length means nothing has played (a failed start), so there is no position worth keeping.
      if (at > 0 && length > 0) setPlaybackProgress(db, item.kind as "movie" | "episode", item.id, Math.floor(at), Math.floor(length));
    };
    const timer = setInterval(save, PROGRESS_EVERY_MS);
    return () => {
      clearInterval(timer);
      save();
    };
  }, [db, item, seriesId, timeshift, vod]);

  if (failing) {
    return (
      <View style={styles.centre}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.muted}>Trying another feed...</Text>
      </View>
    );
  }
  if (status === "error") {
    const raw = error?.message ?? "";
    const message = explain(raw);
    const known = message !== "This couldn't be played.";
    const undecodable = /EXCEEDS_CAPABILITIES|MediaCodec|Decoder|decoder/i.test(raw);
    return (
      <Failure
        title={vod ? playerTitle(stream.title) : stream.title}
        message={message}
        {...(known ? {} : { detail: raw })}
        {...(undecodable
          ? {}
          : {
              onRetry: () => {
                player.replace(stream.url);
                player.play();
              },
            })}
        onExit={timeshift ? () => onCatchup(undefined) : onExit}
      />
    );
  }

  const ended = duration > 0 && position >= duration - 0.5;
  const loading = (status === "loading" || (status === "idle" && !isPlaying)) && !ended;
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const buffered = duration > 0 ? Math.min(1, time.bufferedPosition / duration) : 0;
  const remaining = duration > 0 ? Math.max(0, duration - position) : 0;
  const endsAt = new Date(Date.now() + remaining * 1000);
  const tv = Platform.isTV;
  // The highlight is only drawn for a remote; a phone just taps.
  const lit = (control: Control) => tv && chrome && selected === control;
  const now = new Date();
  // Live TV's bar is how far through the programme the broadcast is (or, in catch-up, the picture). Films and episodes use their own length.
  const programme = vod ? null : timeshift ? { title: catchup.title, start: catchup.start.getTime(), end: catchup.end.getTime() } : airing;
  const programmeRatio =
    programme === null || programme.end <= programme.start
      ? null
      : Math.min(1, Math.max(0, (timeshift ? position * 1000 : Date.now() - programme.start) / (programme.end - programme.start)));
  // Live TV always has the bar: the programme so far when the provider says what is on, otherwise just the live edge.
  const showBar = true;
  const atEdge = !vod && !timeshift && programmeRatio === null;
  const barRatio = vod ? ratio : atEdge ? 1 : (programmeRatio ?? 0);

  return (
    <View style={styles.player}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      {/* Something must hold focus or Android drops the remote's keys before they reach the app; the handler above does the acting. */}
      <Pressable focusable={tv} hasTVPreferredFocus={tv} style={StyleSheet.absoluteFill} onPress={tv ? undefined : () => (awake ? setAwake(false) : wake())} />

      {loading ? (
        <View style={styles.centreLayer} pointerEvents="none">
          <ActivityIndicator size={u(64)} color={colors.foreground} />
        </View>
      ) : null}

      {statsOn && vod ? (
        <View style={styles.stats} pointerEvents="none">
          <Text style={styles.statsTitle}>Stream info</Text>
          <Fact label="Quality" value={facts.quality !== null && facts.size !== null ? `${facts.quality}  (${facts.size})` : (facts.size ?? "Waiting for video")} />
          <Fact label="Frame rate" value={facts.fps ?? "Not reported"} />
          <Fact label="Video" value={[facts.codec, facts.hdr].filter((part) => part !== null).join("  ") || "Not reported"} />
          <Fact label="Bitrate" value={facts.bitrate ?? "Not reported"} />
          <Fact label="Buffered" value={`${Math.max(0, Math.round(time.bufferedPosition - time.currentTime))} s ahead`} />
          <Fact label="Stalls" value={String(stalls)} />
          <Fact label="State" value={loading ? "Buffering" : isPlaying ? "Playing" : "Paused"} />
        </View>
      ) : null}

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents={chrome ? "box-none" : "none"}>
        <View style={styles.top} pointerEvents="box-none">
          <Scrim from="top" />
          <Pressable style={[styles.phoneBack, lit("exit") && styles.backLit]} onPress={onExit}>
            <ChevronGlyph color={lit("exit") ? INK : colors.foreground} />
          </Pressable>
          <Text style={styles.wallClock}>
            {two(now.getHours())}:{two(now.getMinutes())}
          </Text>
        </View>

        <View style={styles.bottom} pointerEvents="box-none">
          <Scrim from="bottom" />
          <View style={styles.info} pointerEvents="none">
            {vod ? null : (
              <View style={[styles.livePill, timeshift && styles.catchupPill, behindLive && styles.behindPill]}>
                {timeshift || behindLive ? null : <View style={styles.liveDot} />}
                <Text style={[styles.liveText, timeshift && styles.catchupText]}>{timeshift ? "CATCH-UP" : behindLive ? "BEHIND LIVE" : "LIVE"}</Text>
              </View>
            )}
            <Text style={styles.heading} numberOfLines={1}>
              {vod ? playerTitle(stream.title) : stream.title}
            </Text>
          </View>
          {programme !== null && !timeshift ? (
            <Text style={styles.programme} numberOfLines={1} pointerEvents="none">
              {`${programme.title}   ${clock24(programme.start)} to ${clock24(programme.end)}`}
            </Text>
          ) : null}
          <View style={styles.chips} pointerEvents="none">
            {[facts.quality, facts.fps, facts.codec, facts.hdr].map((chip) => (chip !== null ? <Chip key={chip} label={chip} /> : null))}
          </View>

          {showBar ? (
            <Pressable
              focusable={false}
              style={styles.barHit}
              onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
              onPress={(event) => barWidth > 0 && seekToRatio(event.nativeEvent.locationX / barWidth)}
            >
              <View style={[styles.track, lit("seek") && styles.trackLit]} pointerEvents="none">
                {vod ? <View style={[styles.fillBuffered, { width: `${buffered * 100}%` }]} /> : null}
                <View style={[styles.fillPlayed, lit("seek") && styles.fillLit, atEdge && !behindLive && styles.fillLive, { width: `${barRatio * 100}%` }]} />
                <View style={[styles.knob, lit("seek") && styles.knobLit, atEdge && !behindLive && styles.knobLive, { left: `${barRatio * 100}%` }]} />
              </View>
            </Pressable>
          ) : null}

          <View style={styles.controls} pointerEvents="box-none">
            <View style={styles.side} pointerEvents="box-none">
              {vod ? null : (
                <View style={styles.liveRow}>
                  <TextKey label={timeshift ? "Back to live" : "Live"} dot={!timeshift && !behindLive} selected={lit("live")} onPress={() => press("live")} />
                  {zapping ? <Text style={styles.clockDim}>{`${at + 1} of ${channels?.length ?? 0}`}</Text> : null}
                </View>
              )}
              {vod ? (
                <Text style={styles.clock}>
                  {clock(position)}
                  <Text style={styles.clockDim}>{duration > 0 ? ` / ${clock(duration)}` : ""}</Text>
                </Text>
              ) : null}
            </View>
            <View style={styles.transport} pointerEvents="box-none">
              {vod || zapping ? (
                <Key selected={lit("back")} active={flash === "back"} onPress={() => step(-1)}>
                  {(ink) => (vod ? <SkipGlyph direction="back" color={ink} /> : <ChannelGlyph direction="back" color={ink} />)}
                </Key>
              ) : null}
              <Key big selected={lit("play")} active={flash === "play"} onPress={togglePause}>
                {(ink) => (isPlaying ? <PauseGlyph color={ink} /> : <PlayGlyph color={ink} />)}
              </Key>
              {vod || zapping ? (
                <Key selected={lit("forward")} active={flash === "forward"} onPress={() => step(1)}>
                  {(ink) => (vod ? <SkipGlyph direction="forward" color={ink} /> : <ChannelGlyph direction="forward" color={ink} />)}
                </Key>
              ) : null}
            </View>
            <View style={[styles.side, styles.sideRight]} pointerEvents="box-none">
              {vod && duration > 0 ? (
                <Text style={styles.clockDim}>
                  Ends {two(endsAt.getHours())}:{two(endsAt.getMinutes())}
                </Text>
              ) : null}
              {previousChannel !== undefined ? <TextKey label={`Last: ${previousChannel.title}`} selected={lit("last")} onPress={() => press("last")} /> : null}
              {archive !== undefined ? <TextKey label="Catch up" selected={lit("catchup")} onPress={() => press("catchup")} /> : null}
              {next !== undefined && onNextEpisode !== undefined ? <TextKey label="Next episode" selected={lit("next")} onPress={() => press("next")} /> : null}
              {vod && tracks.length > 0 ? <TextKey label={captionLabel(captionTrack)} selected={lit("captions")} onPress={() => press("captions")} /> : null}
              {vod ? (
                <Key selected={lit("info")} active={statsOn} onPress={() => press("info")}>
                  {(ink) => <Text style={{ color: ink, fontSize: u(30), fontFamily: "Inter_600SemiBold" }}>i</Text>}
                </Key>
              ) : null}
            </View>
          </View>
        </View>
      </Animated.View>

      {inIntro && !nearEnd ? (
        <View style={styles.nextCard} pointerEvents="none">
          <Text style={styles.nextKicker}>INTRO</Text>
          <Text style={styles.nextTitle}>Skip intro</Text>
          <Text style={styles.nextHint}>Press OK</Text>
        </View>
      ) : null}

      {nearEnd && next !== undefined ? (
        <View style={styles.nextCard} pointerEvents="none">
          <Text style={styles.nextKicker}>NEXT EPISODE</Text>
          <Text style={styles.nextTitle} numberOfLines={2}>
            {`S${next.seasonNumber} E${next.episodeNumber}: ${next.name}`}
          </Text>
          <Text style={styles.nextHint}>{finished && !autoCancelled ? `Starting in ${Math.max(0, autoIn)}. Press any key to stay.` : "Press OK to play it now"}</Text>
        </View>
      ) : null}

      {guide !== undefined ? (
        <View style={styles.guide}>
          <Text style={styles.statsTitle}>Catch up</Text>
          {guide.state === "loading" ? (
            <Text style={styles.guideNote}>Loading...</Text>
          ) : guide.state === "failed" ? (
            <Text style={styles.guideNote}>{"Couldn't reach the provider. Try again in a moment."}</Text>
          ) : guide.entries.length === 0 ? (
            <Text style={styles.guideNote}>Nothing to play back for this channel right now.</Text>
          ) : (
            <ScrollView ref={guideScroll} style={styles.guideList} scrollEnabled={!tv} showsVerticalScrollIndicator={false}>
              {guide.entries.map((entry, index) => {
                const lit = tv && index === guideAt;
                return (
                  <Pressable key={entry.programme.serverStart} focusable={false} onPress={() => playEntry(entry)} style={[styles.guideRow, lit && styles.guideRowLit]}>
                    <Text style={[styles.guideWhen, lit && styles.guideInk]}>{entry.when}</Text>
                    <Text style={[styles.guideTime, lit && styles.guideInk]}>{entry.time}</Text>
                    <Text style={[styles.guideTitle, lit && styles.guideInk]} numberOfLines={1}>
                      {entry.programme.title}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          {tv ? <Text style={styles.guideNote}>Up and down to choose, OK to play, Back to close</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const INK = "#0b0e10";

/** "13:00" from epoch ms. */
const clock24 = (ms: number): string => `${two(new Date(ms).getHours())}:${two(new Date(ms).getMinutes())}`;

/** A transport key: a bare glyph at rest, a solid white disc with a dark glyph when the remote's highlight is on it. */
function Key({ big = false, selected = false, active = false, onPress, children }: { big?: boolean; selected?: boolean; active?: boolean; onPress: () => void; children: (ink: string) => ReactNode }) {
  const filled = selected || active;
  return (
    <Pressable
      focusable={false}
      onPress={onPress}
      style={[styles.key, big ? styles.keyBig : styles.keySmall, filled && styles.keyFilled, filled && { transform: [{ scale: 1.08 }] }]}
    >
      {children(filled ? INK : colors.foreground)}
    </Pressable>
  );
}

/** A transport key with a word on it, for the few actions that have no familiar symbol. */
function TextKey({ label, dot = false, selected = false, onPress }: { label: string; /** A red dot: this is the state the viewer is in right now (watching live). */ dot?: boolean; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable focusable={false} onPress={onPress} style={[styles.key, styles.textKey, selected && styles.keyFilled, selected && { transform: [{ scale: 1.08 }] }]}>
      {dot ? <View style={styles.keyDot} /> : null}
      <Text style={[styles.textKeyLabel, selected && { color: INK }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A darkening that fades out from one edge. It is layered rather than banded: each layer covers from the edge
 * to a little further in, so the darkness builds up in many small steps with no seams between them. (Solid
 * stacked bands showed as stripes across the picture on a big screen.)
 */
const SCRIM_LAYERS = 28;
const SCRIM_ALPHAS = (() => {
  const darkness = (band: number) => (band >= SCRIM_LAYERS ? 0 : 0.85 * (1 - (band + 0.5) / SCRIM_LAYERS) ** 1.5);
  // Layer i covers the first i of the bands, so a band under layers i..N is as dark as the product of them says.
  return Array.from({ length: SCRIM_LAYERS }, (_, index) => 1 - (1 - darkness(index)) / (1 - darkness(index + 1)));
})();

const Scrim = memo(function Scrim({ from }: { from: "top" | "bottom" }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {SCRIM_ALPHAS.map((alpha, index) => (
        <View key={index} style={{ position: "absolute", left: 0, right: 0, [from]: 0, height: `${((index + 1) / SCRIM_LAYERS) * 100}%`, backgroundColor: `rgba(5,7,9,${alpha.toFixed(4)})` }} />
      ))}
    </View>
  );
});

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function ChevronGlyph({ color }: { color: string }) {
  return (
    <View
      style={{
        width: u(18),
        height: u(18),
        marginLeft: u(6),
        borderLeftWidth: u(4),
        borderBottomWidth: u(4),
        borderColor: color,
        transform: [{ rotate: "45deg" }],
      }}
    />
  );
}

/** "|<" / ">|": previous and next channel. */
function ChannelGlyph({ direction, color }: { direction: "back" | "forward"; color: string }) {
  const back = direction === "back";
  const bar = <View key="bar" style={{ width: u(5), height: u(30), backgroundColor: color, borderRadius: u(2) }} />;
  const head = (
    <View
      key="head"
      style={{
        width: 0,
        height: 0,
        borderTopWidth: u(15),
        borderBottomWidth: u(15),
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        ...(back ? { borderRightWidth: u(24), borderRightColor: color } : { borderLeftWidth: u(24), borderLeftColor: color }),
      }}
    />
  );
  return <View style={{ flexDirection: "row", alignItems: "center", gap: u(4) }}>{back ? [bar, head] : [head, bar]}</View>;
}

function PauseGlyph({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: "row", gap: u(9) }}>
      <View style={{ width: u(11), height: u(32), backgroundColor: color, borderRadius: u(3) }} />
      <View style={{ width: u(11), height: u(32), backgroundColor: color, borderRadius: u(3) }} />
    </View>
  );
}

function PlayGlyph({ color }: { color: string }) {
  return (
    <View
      style={{
        marginLeft: u(6),
        width: 0,
        height: 0,
        borderTopWidth: u(18),
        borderBottomWidth: u(18),
        borderLeftWidth: u(30),
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: color,
      }}
    />
  );
}

/** An open ring with an arrowhead where it is open and the number of seconds inside: the usual "replay 10". */
function SkipGlyph({ direction, color }: { direction: "back" | "forward"; color: string }) {
  const size = u(54);
  const head = u(8);
  const forward = direction === "forward";
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, borderWidth: u(4), borderColor: color, borderTopColor: "transparent" }} />
      <View
        style={{
          position: "absolute",
          top: u(2) - head,
          left: size / 2 - (forward ? u(6) : u(9)),
          width: 0,
          height: 0,
          borderTopWidth: head,
          borderBottomWidth: head,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          ...(forward ? { borderLeftWidth: u(13), borderLeftColor: color } : { borderRightWidth: u(13), borderRightColor: color }),
        }}
      />
      <Text style={{ color, fontSize: u(20), fontFamily: "Inter_600SemiBold" }}>{SEEK_STEP_SECS}</Text>
    </View>
  );
}

const styles = styleSheet({
  centre: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: space.l, padding: space.xl },
  row: { flexDirection: "row", gap: space.m },
  player: { flex: 1, backgroundColor: "#000" },
  centreLayer: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },

  top: { position: "absolute", left: 0, right: 0, top: 0, paddingHorizontal: 96, paddingTop: 48, paddingBottom: 90, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  backLit: { backgroundColor: colors.foreground },
  phoneBack: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "#0008" },
  wallClock: { color: colors.foreground, opacity: 0.9, fontSize: 30, fontWeight: "500" },

  nextCard: { position: "absolute", right: 96, bottom: 300, width: 640, gap: 8, padding: 28, borderRadius: 18, backgroundColor: "#0a0d11e6", borderWidth: 2, borderColor: colors.accent },
  nextKicker: { color: colors.accent, fontSize: 22, fontWeight: "600", letterSpacing: 2 },
  nextTitle: { color: colors.foreground, fontSize: 32, fontWeight: "600" },
  nextHint: { color: colors.muted, fontSize: 24 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 96, paddingBottom: 44, paddingTop: 220, gap: 28 },
  info: { flexDirection: "row", alignItems: "center", gap: 20 },
  heading: { flexShrink: 1, color: colors.foreground, fontSize: 44, fontWeight: "600", letterSpacing: -0.5 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.live, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 7 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#fff" },
  liveText: { color: "#fff", fontSize: 19, fontWeight: "600", letterSpacing: 1.5 },
  catchupPill: { backgroundColor: colors.accent },
  behindPill: { backgroundColor: "#ffffff33" },
  catchupText: { color: colors.accentInk },

  barHit: { height: 44, marginVertical: -16, justifyContent: "center" },
  track: { height: 6, borderRadius: 3, backgroundColor: "#ffffff30", justifyContent: "center" },
  trackLit: { height: 10, borderRadius: 5 },
  fillBuffered: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 5, backgroundColor: "#ffffff40" },
  fillLit: { backgroundColor: colors.accent },
  fillLive: { backgroundColor: colors.live },
  knobLive: { backgroundColor: colors.live },
  fillPlayed: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 5, backgroundColor: colors.foreground },
  knob: { position: "absolute", width: 18, height: 18, borderRadius: 9, marginLeft: -9, backgroundColor: colors.foreground },
  knobLit: { width: 30, height: 30, borderRadius: 15, marginLeft: -15 },

  controls: { flexDirection: "row", alignItems: "center" },
  side: { flex: 1, alignItems: "flex-start" },
  sideRight: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 20 },
  chips: { flexDirection: "row", gap: 10, marginTop: -12 },
  chip: { borderRadius: 7, borderWidth: 2, borderColor: "#ffffff66", paddingHorizontal: 12, paddingVertical: 3 },
  chipText: { color: colors.foreground, fontSize: 20, fontWeight: "600", letterSpacing: 0.5 },
  stats: { position: "absolute", right: 96, top: 140, width: 520, gap: 10, padding: 28, borderRadius: 18, backgroundColor: "#000000b3" },
  statsTitle: { color: colors.muted, fontSize: 20, fontWeight: "500", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: 24 },
  factLabel: { color: colors.muted, fontSize: 24 },
  factValue: { color: colors.foreground, fontSize: 24, fontWeight: "500", flexShrink: 1, textAlign: "right" },
  clock: { color: colors.foreground, fontSize: 28, fontWeight: "500" },
  clockDim: { color: colors.foreground, opacity: 0.6, fontSize: 28, fontWeight: "400" },
  transport: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24 },
  key: { alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  keySmall: { width: 80, height: 80, borderRadius: 40 },
  keyBig: { width: 92, height: 92, borderRadius: 46 },
  keyFilled: { backgroundColor: colors.foreground, borderColor: "transparent" },
  textKey: { height: 80, borderRadius: 40, paddingHorizontal: 32, backgroundColor: "#ffffff24", flexDirection: "row", gap: 12 },
  keyDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.live },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 24 },
  programme: { color: colors.foreground, opacity: 0.75, fontSize: 26, marginTop: -14 },
  textKeyLabel: { color: colors.foreground, fontSize: 26, fontWeight: "500" },

  guide: { position: "absolute", right: 96, top: 110, bottom: 110, width: 780, gap: 12, padding: 28, borderRadius: 18, backgroundColor: "#000000e0" },
  guideList: { flex: 1 },
  guideRow: { height: GUIDE_ROW, flexDirection: "row", alignItems: "center", gap: 20, paddingHorizontal: 18, borderRadius: 12 },
  guideRowLit: { backgroundColor: colors.foreground },
  guideWhen: { width: 160, color: colors.muted, fontSize: 24 },
  guideTime: { width: 90, color: colors.foreground, opacity: 0.8, fontSize: 24 },
  guideTitle: { flex: 1, color: colors.foreground, fontSize: 26, fontWeight: "500" },
  guideInk: { color: INK, opacity: 1 },
  guideNote: { color: colors.muted, fontSize: 22 },

  title: { color: colors.foreground, fontSize: 44, fontWeight: "600", letterSpacing: -0.5, textAlign: "center", maxWidth: 1200 },
  muted: { color: colors.muted, fontSize: type.body },
  error: { color: colors.muted, fontSize: 30, textAlign: "center", maxWidth: 1000, lineHeight: 44 },
  detail: { color: colors.faint, fontSize: 20, textAlign: "center", maxWidth: 1000 },
});
