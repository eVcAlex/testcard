import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, BackHandler, Platform, Pressable, StyleSheet, Text, useTVEventHandler, View } from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { setPlaybackProgress } from "@testcard/core/src/db/progressQueries.js";
import { recordRecent } from "@testcard/core/src/db/queries.js";
import { recordMovieRecent } from "@testcard/core/src/db/vodQueries.js";
import { recordSeriesRecent } from "@testcard/core/src/db/seriesQueries.js";
import { playerTitle } from "../ui/titles";
import { resolveStream, type PlayItem, type ResolvedStream } from "../playback/resolveStream";
import { useApp } from "../state/app";
import { colors, space, type, styleSheet, uiScale } from "../theme";
import { Button } from "../ui/controls";

const SEEK_STEP_SECS = 10;
/** Presses in a row (each within this of the last) reach further: 10 s, then 30 s, 1 min, 2 min. */
const STREAK_WITHIN_MS = 600;
const stepForStreak = (count: number) => (count < 2 ? SEEK_STEP_SECS : count < 4 ? 30 : count < 7 ? 60 : 120);
const CHROME_HIDES_AFTER_MS = 4000;
const PROGRESS_EVERY_MS = 5000;

type Control = "exit" | "seek" | "back" | "play" | "forward";

/** A length written in 1920 px design units, for the shapes below that are sized in code. */
const u = (n: number) => Math.round(n * uiScale);

/**
 * Fullscreen playback. On a TV remote: Left/Right seek, OK plays or pauses, Up/Down show the controls,
 * Back leaves. On a phone: tap the picture for the controls. Position is saved every few seconds so
 * "continue watching" and sync have something to carry.
 */
export function PlayerScreen({ item, seriesId, resume, channels, onZap, onExit }: { item: PlayItem; seriesId?: string; resume: boolean; channels?: readonly PlayItem[] | undefined; onZap?: ((channel: PlayItem) => void) | undefined; onExit: () => void }) {
  const { db, sync, updateStatus } = useApp();
  const [stream, setStream] = useState<ResolvedStream>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    resolveStream(db, item, resume).then(
      (resolved) => !cancelled && setStream(resolved),
      (failure: unknown) => !cancelled && setError(failure instanceof Error ? failure.message : "This couldn't be played."),
    );
    return () => {
      cancelled = true;
    };
  }, [db, item, resume]);

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
      item={item}
      stream={stream}
      channels={channels}
      onZap={onZap}
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

function Playing({ item, stream, seriesId, channels, onZap, onExit }: { item: PlayItem; stream: ResolvedStream; seriesId?: string; channels: readonly PlayItem[] | undefined; onZap: ((channel: PlayItem) => void) | undefined; onExit: () => void }) {
  const { db } = useApp();
  const vod = item.kind !== "channel";
  const started = useRef(false);

  const player = useVideoPlayer(stream.url, (instance) => {
    instance.timeUpdateEventInterval = 0.5;
    if (stream.resumeSecs !== null) instance.currentTime = stream.resumeSecs;
    instance.play();
  });

  const { status, error } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
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

  const lastSeek = useRef({ at: 0, direction: 0, count: 0 });
  const seek = useCallback(
    (direction: 1 | -1) => {
      if (!vod) return;
      const now = Date.now();
      const streak = lastSeek.current.direction === direction && now - lastSeek.current.at < STREAK_WITHIN_MS ? lastSeek.current.count + 1 : 0;
      lastSeek.current = { at: now, direction, count: streak };
      const target = Math.min(duration > 0 ? duration - 1 : Infinity, Math.max(0, player.currentTime + direction * stepForStreak(streak)));
      player.currentTime = target;
      setSeekedTo(target);
      pulse(direction === 1 ? "forward" : "back");
      wake();
    },
    [duration, player, pulse, vod, wake],
  );
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
  const zapping = !vod && at >= 0 && channels !== undefined && channels.length > 1 && onZap !== undefined;
  const zap = useCallback(
    (direction: 1 | -1) => {
      if (!zapping || channels === undefined || onZap === undefined) return;
      const next = channels[(at + direction + channels.length) % channels.length];
      if (next !== undefined) onZap(next);
    },
    [at, channels, onZap, zapping],
  );
  const step = useCallback((direction: 1 | -1) => (vod ? seek(direction) : zap(direction)), [seek, vod, zap]);
  const togglePause = useCallback(() => {
    if (player.playing) player.pause();
    else player.play();
    pulse("play");
    wake();
  }, [player, pulse, wake]);

  // The D-pad drives a highlight (`selected`) over the controls: up/down change row, left/right change
  // control (or scrub, on the bar), OK presses. With the controls hidden, left/right seek and OK pauses.
  // Live keeps up/down for changing channel, so its way out sits at the left end of the transport row.
  const rows: Control[][] = vod ? [["exit"], ["seek"], ["back", "play", "forward"]] : zapping ? [["exit", "back", "play", "forward"]] : [["exit"], ["play"]];
  const [selected, setSelected] = useState<Control>("play");
  const press = useCallback(
    (control: Control) => {
      if (control === "exit") onExit();
      else if (control === "back") step(-1);
      else if (control === "forward") step(1);
      else togglePause();
    },
    [onExit, step, togglePause],
  );
  // Android reports remote keys on release (eventKeyAction 1) and, unless key-down events are on, only then.
  useTVEventHandler(
    useCallback(
      (event: { eventType: string; eventKeyAction?: number | undefined }) => {
        if (event.eventKeyAction === 0) return; // a key-down duplicate, if key-down events are ever enabled
        const key = event.eventType;
        if (key === "playPause") return togglePause();
        if (key === "rewind") return step(-1);
        if (key === "fastForward") return step(1);
        // Live: up and down change channel, as on any TV.
        if (zapping && (key === "up" || key === "down")) {
          wake();
          return zap(key === "down" ? 1 : -1);
        }
        if (!chrome) {
          if (key === "left") return seek(-1);
          if (key === "right") return seek(1);
          if (key === "select") return togglePause();
          setSelected("play");
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
      [chrome, press, selected, seek, step, togglePause, vod, wake, zap, zapping],
    ),
  );

  // Recents on first play; progress every few seconds for films and episodes.
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      if (item.kind === "channel") recordRecent(db, item.id);
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
  }, [db, item, seriesId, vod]);

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
        onExit={onExit}
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
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
            <Text style={styles.heading} numberOfLines={1}>
              {vod ? playerTitle(stream.title) : stream.title}
            </Text>
          </View>

          {vod ? (
            <Pressable
              focusable={false}
              style={styles.barHit}
              onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
              onPress={(event) => barWidth > 0 && seekToRatio(event.nativeEvent.locationX / barWidth)}
            >
              <View style={[styles.track, lit("seek") && styles.trackLit]} pointerEvents="none">
                <View style={[styles.fillBuffered, { width: `${buffered * 100}%` }]} />
                <View style={[styles.fillPlayed, lit("seek") && styles.fillLit, { width: `${ratio * 100}%` }]} />
                <View style={[styles.knob, lit("seek") && styles.knobLit, { left: `${ratio * 100}%` }]} />
              </View>
            </Pressable>
          ) : null}

          <View style={styles.controls} pointerEvents="box-none">
            <View style={styles.side} pointerEvents="none">
              {zapping ? <Text style={styles.clockDim}>{`${at + 1} of ${channels?.length ?? 0}`}</Text> : null}
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
            <View style={[styles.side, styles.sideRight]} pointerEvents="none">
              {vod && duration > 0 ? (
                <Text style={styles.clockDim}>
                  Ends {two(endsAt.getHours())}:{two(endsAt.getMinutes())}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const INK = "#0b0e10";

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

/** A darkening that fades out from one edge, built from stacked bands (no gradient library in the app). */
function Scrim({ from }: { from: "top" | "bottom" }) {
  const bands = 32;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: bands }, (_, index) => {
        const strength = from === "top" ? 1 - index / (bands - 1) : index / (bands - 1);
        return <View key={index} style={{ flex: 1, backgroundColor: `rgba(5,7,9,${(0.9 * strength ** 1.5).toFixed(3)})` }} />;
      })}
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

  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 96, paddingBottom: 44, paddingTop: 220, gap: 28 },
  info: { flexDirection: "row", alignItems: "center", gap: 20 },
  heading: { flexShrink: 1, color: colors.foreground, fontSize: 44, fontWeight: "600", letterSpacing: -0.5 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.live, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 7 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#fff" },
  liveText: { color: "#fff", fontSize: 19, fontWeight: "600", letterSpacing: 1.5 },

  barHit: { height: 44, marginVertical: -16, justifyContent: "center" },
  track: { height: 6, borderRadius: 3, backgroundColor: "#ffffff30", justifyContent: "center" },
  trackLit: { height: 10, borderRadius: 5 },
  fillBuffered: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 5, backgroundColor: "#ffffff40" },
  fillLit: { backgroundColor: colors.accent },
  fillPlayed: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 5, backgroundColor: colors.foreground },
  knob: { position: "absolute", width: 18, height: 18, borderRadius: 9, marginLeft: -9, backgroundColor: colors.foreground },
  knobLit: { width: 30, height: 30, borderRadius: 15, marginLeft: -15 },

  controls: { flexDirection: "row", alignItems: "center" },
  side: { flex: 1 },
  sideRight: { alignItems: "flex-end" },
  clock: { color: colors.foreground, fontSize: 28, fontWeight: "500" },
  clockDim: { color: colors.foreground, opacity: 0.6, fontSize: 28, fontWeight: "400" },
  transport: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24 },
  key: { alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  keySmall: { width: 80, height: 80, borderRadius: 40 },
  keyBig: { width: 92, height: 92, borderRadius: 46 },
  keyFilled: { backgroundColor: colors.foreground, borderColor: "transparent" },

  title: { color: colors.foreground, fontSize: 44, fontWeight: "600", letterSpacing: -0.5, textAlign: "center", maxWidth: 1200 },
  muted: { color: colors.muted, fontSize: type.body },
  error: { color: colors.muted, fontSize: 30, textAlign: "center", maxWidth: 1000, lineHeight: 44 },
  detail: { color: colors.faint, fontSize: 20, textAlign: "center", maxWidth: 1000 },
});
