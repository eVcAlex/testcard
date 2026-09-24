import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, BackHandler, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, useTVEventHandler, View } from "react-native";
import { useEvent } from "expo";
import { ArrowLeft, Backward15Seconds, ClosedCaptionsTag, Forward15Seconds, NavArrowLeft, NavArrowRight, Pause, Play, SkipNext } from "iconoir-react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { setPlaybackProgress } from "@testcard/core/src/db/progressQueries.js";
import { recordRecent } from "@testcard/core/src/db/queries.js";
import { recordMovieRecent } from "@testcard/core/src/db/vodQueries.js";
import { findNextEpisode, getSkipWindow, recordSeriesRecent, saveSkipWindow } from "@testcard/core/src/db/seriesQueries.js";
import type { CatchupProgramme } from "@testcard/core/src/source/xtream/catchup.js";
import { playerTitle } from "../ui/titles";
import { resolveStream, type PlayItem, type ResolvedStream } from "../playback/resolveStream";
import { listChannelFeeds, type ChannelFeed } from "@testcard/core/src/db/channelFeeds.js";
import { useApp } from "../state/app";
import { colors, space, type, styleSheet, uiScale } from "../theme";
import { Button } from "../ui/controls";
import { streamFacts } from "../playback/streamInfo";
import { channelCatchup, loadCatchupGuide, type CatchupGuide } from "../playback/catchup";
import { fetchGuide, type Airing } from "../playback/airing";
import { autoCaptionTrack, CAPTION_SETTINGS, nativeCaptionStyle, settingLabel, stepSetting, type CaptionPrefs, type CaptionSetting } from "../playback/captions";
import { guessedCreditsSecs, learnedCreditsSecs, noteCreditsSkipped } from "../playback/credits";

/** 15 s, what the skip buttons' icons say (Iconoir only draws 15 s ones). */
const SEEK_STEP_SECS = 15;
/** Presses in a row (each within this of the last) reach further: 15 s, then 30 s, 1 min, 2 min. */
const STREAK_WITHIN_MS = 600;
const stepForStreak = (count: number) => (count < 2 ? SEEK_STEP_SECS : count < 4 ? 30 : count < 7 ? 60 : 120);
const CHROME_HIDES_AFTER_MS = 4000;
/** A live picture stuck refilling this long is reloaded, at most this many times. */
const STUCK_AFTER_MS = 12_000;
const MAX_RELOADS = 4;
/** How long a live feed may take to show a picture before the next one is tried. */
const START_WITHIN_MS = 15_000;
/** Once the credits are known to have started (see playback/credits), the next episode starts by itself this long after. */
const CREDITS_COUNTDOWN_SECS = 10;
/** After an episode ends, the next one starts by itself this many seconds later unless a key is pressed. */
const AUTO_NEXT_SECS = 8;
/** Stepping to another channel remounts the player, so the highlighted control is carried across, and spamming next or previous keeps working. */
let carriedSelection: Control | undefined;
/** The channel being watched and the one before it, kept across channel changes so "Last" can flip back, as on a TV remote. */
let channelHistory: { current?: PlayItem; previous?: PlayItem } = {};
const PROGRESS_EVERY_MS = 5000;

/** Presses of the remote, as opposed to the focus and blur events the same handler also receives. */
const REMOTE_KEYS = new Set(["up", "down", "left", "right", "select", "playPause", "rewind", "fastForward"]);

type Control = "exit" | "seek" | "back" | "play" | "forward" | "captions" | "next" | "last" | "live" | "catchup";

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
  // A live channel that will not play is tried again on its other feeds (another quality, a backup, the same channel
  // listed elsewhere) before the viewer sees an error.
  const [feedAt, setFeedAt] = useState(0);
  const feeds = useMemo(() => (item.kind === "channel" ? listChannelFeeds(db, item.id) : []), [db, item]);
  const feed: ChannelFeed | undefined = feeds[feedAt];
  const failOver = useCallback(() => setFeedAt((at) => at + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    // Cleared first, or the dead feed is mounted again under the new key while the next one resolves.
    setStream(undefined);
    resolveStream(db, item, resume, catchup, feedAt > 0 ? feed : undefined).then(
      (resolved) => !cancelled && setStream(resolved),
      (failure: unknown) => !cancelled && setError(failure instanceof Error ? failure.message : "This couldn't be played."),
    );
    return () => {
      cancelled = true;
    };
  }, [db, item, resume, catchup, feedAt, feed]);

  // Once Playing is on screen it owns Back itself (hide the controls, then leave); this is only for the
  // loading and failure states before that, which would otherwise have no way to leave on Back at all.
  useEffect(() => {
    if (stream !== undefined && error === undefined) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onExit();
      return true;
    });
    return () => subscription.remove();
  }, [onExit, stream, error]);

  if (error !== undefined) return <Failure title={item.title} message={error} onExit={onExit} />;
  if (stream === undefined) {
    // The same black screen and spinner the player itself shows while buffering, so starting an
    // episode reads as one continuous action instead of a separate loading page first.
    return (
      <View style={styles.player}>
        <View style={styles.centreLayer} pointerEvents="none">
          <ActivityIndicator size={u(64)} color={colors.foreground} />
        </View>
      </View>
    );
  }
  return (
    <Playing
      key={`${catchup === undefined ? "live" : catchup.serverStart}:${feedAt}`}
      item={item}
      stream={stream}
      catchup={catchup}
      onCatchup={(programme) => setPicked(programme === undefined ? undefined : { channelId: item.id, programme })}
      channels={channels}
      onZap={onZap}
      onNextEpisode={onNextEpisode}
      moreFeeds={feedAt + 1 < feeds.length}
      onFailOver={failOver}
      fellBack={feedAt > 0 && feed !== undefined ? fellBackLabel(item.title, feed) : undefined}
      onExit={() => {
        sync.notifyLocalChange();
        updateStatus();
        onExit();
      }}
      {...(seriesId !== undefined ? { seriesId } : {})}
    />
  );
}

/** What the viewer is told once a channel is playing on a feed other than the first. */
function fellBackLabel(title: string, feed: ChannelFeed): string {
  if (feed.name !== title) return `Playing ${feed.name} instead`;
  return feed.quality !== null ? `Playing the ${feed.quality} feed instead` : "Playing a backup feed instead";
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

function Playing({ item, stream, catchup, onCatchup, seriesId, channels, onZap, onNextEpisode, moreFeeds, onFailOver, fellBack, onExit }: { onNextEpisode: ((episode: PlayItem) => void) | undefined; moreFeeds: boolean; onFailOver: () => void; fellBack: string | undefined; item: PlayItem; stream: ResolvedStream; catchup: CatchupProgramme | undefined; onCatchup: (programme: CatchupProgramme | undefined) => void; seriesId?: string; channels: readonly PlayItem[] | undefined; onZap: ((channel: PlayItem) => void) | undefined; onExit: () => void }) {
  const { db, sync, captions, setCaptions } = useApp();
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
    // Some providers flag a subtitle track as the stream's default, which the native player would otherwise
    // turn on by itself; captions only come on here when the CC button is pressed.
    instance.subtitleTrack = null;
    instance.play();
  });

  const { status, error } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { videoTrack } = useEvent(player, "videoTrackChange", { videoTrack: player.videoTrack });
  const facts = streamFacts(videoTrack);
  const everPlayed = useRef(false);
  useEffect(() => {
    if (status === "readyToPlay") everPlayed.current = true;
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
  // Some dead streams never error, they just never start: after a while, the next feed is tried instead.
  const neverStarted = !vod && !timeshift && moreFeeds && status !== "readyToPlay" && status !== "error";
  useEffect(() => {
    if (!neverStarted || everPlayed.current) return;
    const timer = setTimeout(() => {
      if (!everPlayed.current) onFailOver();
    }, START_WITHIN_MS);
    return () => clearTimeout(timer);
  }, [neverStarted, onFailOver]);
  // Once the picture is up on a feed that was not the first, say which, for a moment.
  const [fellBackShown, setFellBackShown] = useState(false);
  const pictureUp = status === "readyToPlay";
  const fellBackSaid = useRef(false);
  useEffect(() => {
    if (fellBack === undefined || !pictureUp || fellBackSaid.current) return;
    fellBackSaid.current = true;
    setFellBackShown(true);
  }, [fellBack, pictureUp]);
  useEffect(() => {
    if (!fellBackShown) return;
    const timer = setTimeout(() => setFellBackShown(false), 5000);
    return () => clearTimeout(timer);
  }, [fellBackShown]);

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
  // Captions the file carries, chosen from a list: Off, then each track.
  const tracks = useEvent(player, "availableSubtitleTracksChange", { availableSubtitleTracks: player.availableSubtitleTracks }).availableSubtitleTracks;
  const captionTrack = useEvent(player, "subtitleTrackChange", { subtitleTrack: player.subtitleTrack, oldSubtitleTrack: null }).subtitleTrack;
  const captionName = (track: (typeof tracks)[number] | null) => (track === null ? "Off" : track.label !== "" ? track.label : track.language !== "" ? track.language : "On");
  const captionOptions = useMemo(() => [null, ...tracks], [tracks]);
  const currentCaption = captionOptions.findIndex((track) => (track === null ? captionTrack === null : captionTrack !== null && track.id === captionTrack.id && track.label === captionTrack.label && track.language === captionTrack.language));
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [captionAt, setCaptionAt] = useState(0);
  const openCaptions = useCallback(() => {
    setCaptionAt(Math.max(0, currentCaption));
    setCaptionsOpen(true);
  }, [currentCaption]);
  const captionsScroll = useRef<ScrollView>(null);
  // The track rows, then a heading row, then the style settings: the heading counts as a row so the list scrolls evenly.
  const settingAt = (index: number): CaptionSetting | undefined => CAPTION_SETTINGS[index - captionOptions.length];
  const captionRows = captionOptions.length + CAPTION_SETTINGS.length;
  useEffect(() => captionsScroll.current?.scrollTo({ y: Math.max(0, captionAt + (captionAt >= captionOptions.length ? 1 : 0) - 3) * u(GUIDE_ROW), animated: false }), [captionAt, captionOptions.length]);
  const chooseCaption = useCallback(
    (index: number) => {
      player.subtitleTrack = captionOptions[index] ?? null;
      setCaptionsOpen(false);
    },
    [captionOptions, player],
  );
  // Films and episodes start with captions on when the viewer has asked for them always, in their language. Once
  // per stream, when its tracks turn up (a moment after it starts); after that the viewer's own choice stands.
  const autoCaptioned = useRef(false);
  useEffect(() => {
    if (!vod || autoCaptioned.current || tracks.length === 0) return;
    autoCaptioned.current = true;
    const track = autoCaptionTrack(captions, tracks);
    if (track !== null) player.subtitleTrack = track;
  }, [captions, player, tracks, vod]);
  // A style setting changed from the panel takes effect on the picture straight away; turning "always" on, or
  // changing its language, also picks the track that goes with it now.
  const changeCaptions = useCallback(
    (prefs: CaptionPrefs, setting: CaptionSetting) => {
      setCaptions(prefs);
      if ((setting.key === "always" || setting.key === "language") && prefs.always) player.subtitleTrack = autoCaptionTrack(prefs, tracks);
    },
    [player, setCaptions, tracks],
  );
  const captionStyle = useMemo(() => (Platform.OS === "android" ? nativeCaptionStyle(captions) : undefined), [captions]);
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

  // An episode offers the next one once its credits start, as the streaming apps do: "Watch credits" or "Next
  // episode". Where the credits start is learned from the viewer (see playback/credits); once it is, the next
  // episode also starts by itself after a short countdown. Before that the offer comes at an estimate, with no
  // countdown (it may still be the last scene), and the next episode starts by itself only once this one ends.
  const next = useMemo(() => (item.kind === "episode" ? findNextEpisode(db, item.id) : undefined), [db, item]);
  const learnedCredits = useMemo(() => (item.kind === "episode" && seriesId !== undefined ? learnedCreditsSecs(db, seriesId) : undefined), [db, item.kind, seriesId]);
  const creditsSecs = learnedCredits ?? guessedCreditsSecs(duration);
  const nearEnd = next !== undefined && onNextEpisode !== undefined && duration > 300 && position >= duration - creditsSecs;
  const finished = nearEnd && position >= duration - 0.5;
  // "Watch credits" puts the offer away until the episode ends; it comes back then, counting down.
  const [creditsChosen, setCreditsChosen] = useState(false);
  const cardUp = nearEnd && (!creditsChosen || finished);
  const [cardAt, setCardAt] = useState<"credits" | "next">("next");
  // Skip intro: what the viewer last skipped at the start of this series is offered again where it starts in each episode.
  const skip = useMemo(() => (item.kind === "episode" && seriesId !== undefined ? getSkipWindow(db, seriesId) : undefined), [db, item, seriesId]);
  const inIntro = skip !== undefined && position >= skip.fromSecs - 3 && position < skip.toSecs - 2 && duration > skip.toSecs + 60;
  const [autoCancelled, setAutoCancelled] = useState(false);
  // Moving back out of the credits (a seek) starts the offer afresh next time they are reached.
  useEffect(() => {
    if (nearEnd) return;
    setCreditsChosen(false);
    setAutoCancelled(false);
    setCardAt("next");
  }, [nearEnd]);
  /** `byViewer`: pressed, not the countdown; how much was left is then learned as the series' credits. */
  const goNext = useCallback(
    (byViewer: boolean) => {
      if (next === undefined) return;
      if (byViewer && seriesId !== undefined) noteCreditsSkipped(db, seriesId, latest.current.duration - latest.current.position, latest.current.duration);
      onNextEpisode?.({ kind: "episode", id: next.id, title: next.name });
    },
    [db, next, onNextEpisode, seriesId],
  );
  const watchCredits = useCallback(() => {
    setCreditsChosen(true);
    setCardAt("next");
  }, []);
  const counting = cardUp && !autoCancelled && (learnedCredits !== undefined || finished);
  const countFor = finished ? AUTO_NEXT_SECS : CREDITS_COUNTDOWN_SECS;
  // The countdown is drawn as a fill across the Next episode button, driven natively; when it completes, the next episode starts.
  const countdown = useRef(new Animated.Value(0)).current;
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;
  useEffect(() => {
    countdown.setValue(0);
    if (!counting) return;
    const run = Animated.timing(countdown, { toValue: 1, duration: countFor * 1000, easing: Easing.linear, useNativeDriver: true });
    run.start(({ finished: done }) => {
      if (done) goNextRef.current(false);
    });
    return () => run.stop();
  }, [countFor, countdown, counting]);

  // The controls fade out while playing and come back on any key, tap or pause.
  const [awake, setAwake] = useState(true);
  // Back hides the controls even over a paused picture (where they would otherwise stay up); any key brings them back.
  const [muted, setMuted] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = useCallback(() => {
    setMuted(false);
    setAwake(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setAwake(false), CHROME_HIDES_AFTER_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => clearTimeout(hideTimer.current);
  }, [wake]);
  const chrome = !muted && (awake || !isPlaying);
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
  // Back closes an open overlay, else hides the controls (playing or paused), else leaves — checked in
  // that order on every press. This is the only Back handler once Playing is mounted (PlayerScreen's own
  // only covers loading/failure, before this) and it subscribes exactly once for the component's whole
  // lifetime: `chrome` flips on every auto-hide tick, and re-subscribing on each flip (as this used to)
  // reintroduces the same kind of race that made Back sometimes skip straight past hiding to exit.
  const backStateRef = useRef({ guideOpen, captionsOpen, chrome, onExit, creditsOffer: cardUp && !finished, watchCredits });
  backStateRef.current = { guideOpen, captionsOpen, chrome, onExit, creditsOffer: cardUp && !finished, watchCredits };
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const state = backStateRef.current;
      if (state.guideOpen) setGuide(undefined);
      else if (state.captionsOpen) setCaptionsOpen(false);
      else if (state.chrome) {
        clearTimeout(hideTimer.current);
        setAwake(false);
        setMuted(true);
      } else if (state.creditsOffer) state.watchCredits();
      else state.onExit();
      return true;
    });
    return () => subscription.remove();
  }, []);
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
  // control (or scrub, on the bar), OK presses. With the controls hidden, left/right skip a film or episode and any
  // other key only brings the controls up. Playback always starts highlighted on Play/Pause, never the scrub bar.
  // Live keeps up/down for changing channel, so its way out sits at the left end of the transport row.
  // Remember the channel; once there is an earlier one, a Last key flips back to it.
  if (item.kind === "channel" && !timeshift && channelHistory.current?.id !== item.id) channelHistory = { previous: channelHistory.current, current: item };
  const previousChannel = zapping ? channelHistory.previous : undefined;
  const more: Control[] = [...(previousChannel !== undefined ? (["last"] as const) : []), ...(archive !== undefined ? (["catchup"] as const) : [])];
  // The side-right keys (captions, next) join the transport row's navigation order when they exist.
  const captionsKey: Control[] = tracks.length > 0 ? ["captions"] : [];
  const nextKey: Control[] = next !== undefined && onNextEpisode !== undefined ? ["next"] : [];
  const rows: Control[][] = vod ? [["exit"], ["seek"], ["back", "play", "forward", ...captionsKey, ...nextKey]] : zapping ? [["exit", "live", "back", "play", "forward", ...more]] : [["exit", "live", "play", ...more]];
  // Read through a ref by the key handler: the captions and next keys can appear after it was last rebuilt
  // (subtitle tracks turn up a moment after the stream starts), and it must navigate to them straight away.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [selected, setSelected] = useState<Control>(() => {
    const carried = carriedSelection;
    carriedSelection = undefined;
    return carried ?? "play";
  });
  const press = useCallback(
    (control: Control) => {
      if (control === "exit") onExit();
      else if (control === "back" || control === "forward") {
        if (zapping) carriedSelection = control;
        step(control === "back" ? -1 : 1);
      }
      else if (control === "captions") openCaptions();
      else if (control === "next") goNext(true);
      else if (control === "last") {
        const previous = channelHistory.previous;
        if (previous !== undefined && onZap !== undefined) {
          carriedSelection = "last";
          onZap(previous);
        }
      }
      else if (control === "catchup") openGuide();
      else if (control === "live") {
        if (timeshift) onCatchup(undefined);
        else if (behindLive) goLive();
        else wake();
      }
      else togglePause();
    },
    [behindLive, openCaptions, goLive, goNext, onCatchup, onExit, onZap, openGuide, step, timeshift, togglePause, wake, zapping],
  );
  // Android reports remote keys on release (eventKeyAction 1) and, unless key-down events are on, only then.
  const handleKey = useCallback(
    (event: { eventType: string; eventKeyAction?: number | undefined }) => {
      if (event.eventKeyAction === 0) return; // a key-down duplicate, if key-down events are ever enabled
      const key = event.eventType;
      if (inIntro && key === "select" && (!chrome || selected === "seek" || selected === "play")) return skipIntro();
      // While the next episode is on offer and the controls are hidden, left and right move between its two
      // buttons and OK presses one. Any other key means the viewer is doing something else: the countdown stops.
      if (cardUp && !captionsOpen && !guideOpen) {
        if (!chrome && (key === "left" || key === "right")) return setCardAt(key === "left" && !finished ? "credits" : "next");
        if (!chrome && key === "select") return cardAt === "credits" && !finished ? watchCredits() : goNext(true);
        if (REMOTE_KEYS.has(key)) setAutoCancelled(true);
      }
      if (captionsOpen) {
        const setting = settingAt(captionAt);
        if (key === "up" || key === "down") setCaptionAt((at) => Math.min(captionRows - 1, Math.max(0, at + (key === "down" ? 1 : -1))));
        else if (setting !== undefined && (key === "select" || key === "left" || key === "right")) changeCaptions(stepSetting(captions, setting, key === "left" ? -1 : 1), setting);
        else if (key === "select") chooseCaption(captionAt);
        else if (key === "left") setCaptionsOpen(false);
        return;
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
        // Any key brings the controls up, highlighted on Play/Pause; pausing is the play key's job. Left and right
        // skip straight away on a film or episode, as on every TV player: one press, not "over to the button, OK".
        setSelected("play");
        if (vod && (key === "left" || key === "right")) return seek(key === "right" ? 1 : -1);
        return wake();
      }
      wake();
      const row = rowsRef.current.findIndex((r) => r.includes(selected));
      if (key === "up" || key === "down") {
        const next = rowsRef.current[Math.min(rowsRef.current.length - 1, Math.max(0, row + (key === "down" ? 1 : -1)))];
        if (next !== undefined) setSelected(next.includes("play") ? "play" : (next[0] as Control));
      } else if (key === "left" || key === "right") {
        if (selected === "seek") return seek(key === "right" ? 1 : -1);
        const controls = rowsRef.current[row] ?? [];
        const at = controls.indexOf(selected);
        const next = controls[Math.min(controls.length - 1, Math.max(0, at + (key === "right" ? 1 : -1)))];
        if (next !== undefined) setSelected(next);
      } else if (key === "select") {
        press(selected);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [captionAt, captionOptions.length, captionRows, captions, captionsOpen, cardAt, cardUp, changeCaptions, chooseCaption, chrome, finished, goNext, guide, guideAt, guideOpen, inIntro, playEntry, skipIntro, press, selected, seek, step, togglePause, vod, watchCredits, wake, zap, zapping],
  );
  // The listener below re-subscribes to the native remote-event emitter whenever its callback identity
  // changes; going through a ref keeps that identity fixed so a run of key presses doesn't churn the
  // native subscription (which briefly drops it) or risk it seeing a handler mid-swap.
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;
  useTVEventHandler(useCallback((event: { eventType: string; eventKeyAction?: number | undefined }) => handleKeyRef.current(event), []));

  // Recents on first play; progress every few seconds for films and episodes. Each write also
  // nudges sync, so another device picks up "what I'm watching" within seconds, not the up-to-a-
  // minute periodic tick — notifyLocalChange is cheap to call this often, it just coalesces.
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      if (item.kind === "channel") {
        if (!timeshift) recordRecent(db, item.id);
      }
      else if (item.kind === "movie") recordMovieRecent(db, item.id);
      else if (seriesId !== undefined) recordSeriesRecent(db, seriesId);
      sync.notifyLocalChange();
    }
    if (!vod) return;
    const save = () => {
      const { position: at, duration: length } = latest.current;
      // No known length means nothing has played (a failed start), so there is no position worth keeping.
      if (at > 0 && length > 0) {
        setPlaybackProgress(db, item.kind as "movie" | "episode", item.id, Math.floor(at), Math.floor(length));
        sync.notifyLocalChange();
      }
    };
    const timer = setInterval(save, PROGRESS_EVERY_MS);
    return () => {
      clearInterval(timer);
      save();
    };
  }, [db, item, seriesId, timeshift, vod, sync]);

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
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} captionStyle={captionStyle} />
      {/* Something must hold focus or Android drops the remote's keys before they reach the app; the handler above does the acting. */}
      <Pressable focusable={tv} hasTVPreferredFocus={tv} style={StyleSheet.absoluteFill} onPress={tv ? undefined : () => (awake ? setAwake(false) : wake())} />

      {loading ? (
        <View style={styles.centreLayer} pointerEvents="none">
          <ActivityIndicator size={u(64)} color={colors.foreground} />
        </View>
      ) : null}
      {fellBackShown && fellBack !== undefined ? (
        <View style={styles.fellBack} pointerEvents="none">
          <Text style={styles.fellBackText}>{`That feed wouldn't play. ${fellBack}.`}</Text>
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
                  {duration > 0 ? (
                    <Text style={styles.clockDim}>{`   Ends ${two(endsAt.getHours())}:${two(endsAt.getMinutes())}`}</Text>
                  ) : null}
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
              {vod ? (
                <Key selected={lit("captions")} active={false} disabled={tracks.length === 0} onPress={openCaptions}>
                  {(ink) => <CcGlyph on={captionTrack !== null} color={ink} />}
                </Key>
              ) : null}
              {nextKey.length > 0 ? (
                <Key selected={lit("next")} active={false} onPress={() => goNext(true)}>
                  {(ink) => <NextGlyph color={ink} />}
                </Key>
              ) : null}
              {previousChannel !== undefined ? <TextKey label={previousChannel.title.length > 16 ? `Last: ${previousChannel.title.slice(0, 15)}...` : `Last: ${previousChannel.title}`} selected={lit("last")} onPress={() => press("last")} /> : null}
              {archive !== undefined ? <TextKey label="Catch up" selected={lit("catchup")} onPress={() => press("catchup")} /> : null}
            </View>
          </View>
          {/* Hidden until the remote is pressed Down onto this row (a phone has no Down, so it always shows). */}
          </View>
      </Animated.View>

      {/* The streaming apps' corner buttons: lit (OK presses them) while the controls are hidden. */}
      {inIntro && !cardUp ? (
        <View style={[styles.offer, chrome && styles.offerRaised]} pointerEvents="box-none">
          <Pressable focusable={false} onPress={skipIntro} style={[styles.offerKey, (!tv || !chrome) && styles.offerKeyLit]}>
            <Text style={[styles.offerLabel, (!tv || !chrome) && styles.offerLabelLit]}>Skip intro</Text>
          </Pressable>
        </View>
      ) : null}

      {cardUp && next !== undefined ? (
        <View style={[styles.offer, chrome && styles.offerRaised]} pointerEvents="box-none">
          <Text style={styles.offerNext} numberOfLines={1}>
            {`Next: S${next.seasonNumber} E${next.episodeNumber}  ${next.name}`}
          </Text>
          <View style={styles.offerKeys} pointerEvents="box-none">
            {finished ? null : (
              <Pressable focusable={false} onPress={watchCredits} style={[styles.offerKey, tv && !chrome && cardAt === "credits" && styles.offerKeyLit]}>
                <Text style={[styles.offerLabel, tv && !chrome && cardAt === "credits" && styles.offerLabelLit]}>Watch credits</Text>
              </Pressable>
            )}
            <Pressable focusable={false} onPress={() => goNext(true)} style={[styles.offerKey, styles.nextKey, (!tv || (!chrome && cardAt === "next")) && styles.nextKeyLit]}>
              <Animated.View
                pointerEvents="none"
                style={[styles.nextFill, { transform: [{ translateX: -u(NEXT_KEY_WIDTH) / 2 }, { scaleX: countdown }, { translateX: u(NEXT_KEY_WIDTH) / 2 }] }]}
              />
              <Play color={INK} width={u(34)} height={u(34)} strokeWidth={2} />
              <Text style={[styles.offerLabel, styles.offerLabelLit]}>Next episode</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {captionsOpen ? (
        <View style={styles.guide}>
          <Text style={styles.statsTitle}>Captions</Text>
          <ScrollView ref={captionsScroll} style={styles.guideList} scrollEnabled={!tv} showsVerticalScrollIndicator={false}>
            {captionOptions.map((track, index) => {
              const lit = tv && index === captionAt;
              return (
                <Pressable key={index} focusable={false} onPress={() => chooseCaption(index)} style={[styles.guideRow, lit && styles.guideRowLit]}>
                  <Text style={[styles.guideTitle, lit && styles.guideInk]} numberOfLines={1}>
                    {captionName(track)}
                  </Text>
                  <Text style={[styles.guideTime, lit && styles.guideInk]}>{index === currentCaption ? "On now" : ""}</Text>
                </Pressable>
              );
            })}
            <Text style={[styles.statsTitle, styles.panelHeading]}>Style and default</Text>
            {CAPTION_SETTINGS.map((setting, index) => {
              const lit = tv && captionOptions.length + index === captionAt;
              return (
                <Pressable key={setting.key} focusable={false} onPress={() => changeCaptions(stepSetting(captions, setting, 1), setting)} style={[styles.guideRow, lit && styles.guideRowLit]}>
                  <Text style={[styles.guideTitle, lit && styles.guideInk]} numberOfLines={1}>
                    {setting.label}
                  </Text>
                  <Text style={[styles.settingValue, lit && styles.guideInk]} numberOfLines={1}>
                    {lit ? `‹  ${settingLabel(captions, setting)}  ›` : settingLabel(captions, setting)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {tv ? <Text style={styles.guideNote}>OK to select a track, left and right to change a setting, Back to close</Text> : null}
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
/** The Next episode button is a fixed width so its countdown fill can be scaled across it. */
const NEXT_KEY_WIDTH = 330;

/** "13:00" from epoch ms. */
const clock24 = (ms: number): string => `${two(new Date(ms).getHours())}:${two(new Date(ms).getMinutes())}`;

/** A transport key: a bare glyph at rest, a solid white disc with a dark glyph when the remote's highlight is on it. */
function Key({ big = false, selected = false, active = false, disabled = false, onPress, children }: { big?: boolean; selected?: boolean; active?: boolean; disabled?: boolean; onPress: () => void; children: (ink: string) => ReactNode }) {
  const filled = selected || active;
  return (
    <Pressable
      focusable={false}
      onPress={disabled ? undefined : onPress}
      style={[styles.key, big ? styles.keyBig : styles.keySmall, filled && styles.keyFilled, filled && { transform: [{ scale: 1.08 }] }, disabled && styles.keyDisabled]}
    >
      {children(filled ? INK : disabled ? "#ffffff42" : colors.foreground)}
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

/** The closed-captions mark: cream as an icon while a track is on. */
function CcGlyph({ on, color }: { on: boolean; color: string }) {
  return <ClosedCaptionsTag color={on ? colors.accent : color} width={u(38)} height={u(38)} strokeWidth={1.75} />;
}

/** Skip-to-next: the streaming apps' "next episode" mark. */
function NextGlyph({ color }: { color: string }) {
  return <SkipNext color={color} width={u(38)} height={u(38)} strokeWidth={1.75} />;
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

function ChevronGlyph({ color }: { color: string }) {
  return <ArrowLeft color={color} width={u(32)} height={u(32)} strokeWidth={1.75} />;
}

/** Previous and next channel. */
function ChannelGlyph({ direction, color }: { direction: "back" | "forward"; color: string }) {
  const Icon = direction === "back" ? NavArrowLeft : NavArrowRight;
  return <Icon color={color} width={u(40)} height={u(40)} strokeWidth={1.75} />;
}

function PauseGlyph({ color }: { color: string }) {
  return <Pause color={color} width={u(42)} height={u(42)} strokeWidth={1.75} />;
}

function PlayGlyph({ color }: { color: string }) {
  return <Play color={color} width={u(44)} height={u(44)} strokeWidth={1.75} />;
}

/** Replay and advance by the seek step. */
function SkipGlyph({ direction, color }: { direction: "back" | "forward"; color: string }) {
  const Icon = direction === "back" ? Backward15Seconds : Forward15Seconds;
  return <Icon color={color} width={u(44)} height={u(44)} strokeWidth={1.75} />;
}

const styles = styleSheet({
  centre: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: space.l, padding: space.xl },
  row: { flexDirection: "row", gap: space.m },
  player: { flex: 1, backgroundColor: "#000" },
  centreLayer: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  fellBack: { position: "absolute", left: 0, right: 0, top: 48, alignItems: "center" },
  fellBackText: { color: colors.foreground, fontSize: 26, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 999, backgroundColor: "#000000d9", overflow: "hidden" },

  top: { position: "absolute", left: 0, right: 0, top: 0, paddingHorizontal: 96, paddingTop: 48, paddingBottom: 90, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  backLit: { backgroundColor: colors.foreground },
  phoneBack: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "#0008" },
  wallClock: { color: colors.foreground, opacity: 0.9, fontSize: 30, fontWeight: "500" },

  // Bottom right, clear of the controls when they are up.
  offer: { position: "absolute", right: 96, bottom: 110, alignItems: "flex-end", gap: 16 },
  offerRaised: { bottom: 330 },
  offerNext: { maxWidth: 820, color: colors.foreground, fontSize: 26, fontWeight: "500", textShadowColor: "#000000cc", textShadowRadius: 8 },
  offerKeys: { flexDirection: "row", gap: 20 },
  offerKey: { height: 76, paddingHorizontal: 36, borderRadius: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#15191ecc", borderWidth: 2, borderColor: "#ffffff55" },
  offerKeyLit: { backgroundColor: colors.foreground, borderColor: colors.foreground, transform: [{ scale: 1.06 }] },
  offerLabel: { color: colors.foreground, fontSize: 26, fontWeight: "600" },
  offerLabelLit: { color: INK },
  nextKey: { width: NEXT_KEY_WIDTH, overflow: "hidden", backgroundColor: "#f2eee7b3", borderColor: "transparent" },
  nextKeyLit: { backgroundColor: colors.foreground, borderColor: colors.accent, transform: [{ scale: 1.06 }] },
  nextFill: { position: "absolute", left: 0, top: 0, bottom: 0, width: NEXT_KEY_WIDTH, backgroundColor: "#0b0e1033" },
  panelHeading: { height: GUIDE_ROW, paddingTop: 22, paddingHorizontal: 18, marginBottom: 0 },
  settingValue: { maxWidth: 340, color: colors.muted, fontSize: 24 },
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
  statsTitle: { color: colors.muted, fontSize: 20, fontWeight: "500", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 },
  clock: { color: colors.foreground, fontSize: 28, fontWeight: "500" },
  clockDim: { color: colors.foreground, opacity: 0.6, fontSize: 28, fontWeight: "400" },
  transport: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24 },
  key: { alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  keySmall: { width: 80, height: 80, borderRadius: 40 },
  keyBig: { width: 92, height: 92, borderRadius: 46 },
  keyFilled: { backgroundColor: colors.foreground, borderColor: "transparent" },
  keyDisabled: { opacity: 0.35 },
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
