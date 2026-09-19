import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, BackHandler, Platform, Pressable, StyleSheet, Text, useTVEventHandler, View } from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { setPlaybackProgress } from "@testcard/core/src/db/progressQueries.js";
import { recordRecent } from "@testcard/core/src/db/queries.js";
import { recordMovieRecent } from "@testcard/core/src/db/vodQueries.js";
import { recordSeriesRecent } from "@testcard/core/src/db/seriesQueries.js";
import { resolveStream, type PlayItem, type ResolvedStream } from "../playback/resolveStream";
import { useApp } from "../state/app";
import { colors, space, type, styleSheet, uiScale } from "../theme";
import { Button } from "../ui/controls";

const SEEK_STEP_SECS = 10;
const SEEK_HELD_SECS = 30;
const HELD_WITHIN_MS = 350;
const CHROME_HIDES_AFTER_MS = 4000;
const PROGRESS_EVERY_MS = 5000;

type Control = "close" | "seek" | "back" | "play" | "forward";

/** A length written in 1920 px design units, for the shapes below that are sized in code. */
const u = (n: number) => Math.round(n * uiScale);

/**
 * Fullscreen playback. On a TV remote: Left/Right seek, OK plays or pauses, Up/Down show the controls,
 * Back leaves. On a phone: tap the picture for the controls. Position is saved every few seconds so
 * "continue watching" and sync have something to carry.
 */
export function PlayerScreen({ item, seriesId, resume, onExit }: { item: PlayItem; seriesId?: string; resume: boolean; onExit: () => void }) {
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
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.error}>{message}</Text>
      {detail !== undefined && detail !== "" ? <Text style={styles.detail}>{detail}</Text> : null}
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

function Playing({ item, stream, seriesId, onExit }: { item: PlayItem; stream: ResolvedStream; seriesId?: string; onExit: () => void }) {
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

  const lastSeek = useRef({ at: 0, direction: 0 });
  const seek = useCallback(
    (direction: 1 | -1) => {
      if (!vod) return;
      const now = Date.now();
      const held = lastSeek.current.direction === direction && now - lastSeek.current.at < HELD_WITHIN_MS;
      lastSeek.current = { at: now, direction };
      const target = Math.min(duration > 0 ? duration - 1 : Infinity, Math.max(0, player.currentTime + direction * (held ? SEEK_HELD_SECS : SEEK_STEP_SECS)));
      player.currentTime = target;
      setSeekedTo(target);
      pulse(direction === 1 ? "forward" : "back");
      wake();
    },
    [duration, player, pulse, vod, wake],
  );
  const togglePause = useCallback(() => {
    if (player.playing) player.pause();
    else player.play();
    pulse("play");
    wake();
  }, [player, pulse, wake]);

  // The D-pad drives a highlight (`selected`) over the controls: up/down change row, left/right change
  // control (or scrub, on the bar), OK presses. With the controls hidden, left/right seek and OK pauses.
  const rows: Control[][] = vod ? [["close"], ["seek"], ["back", "play", "forward"]] : [["close"], ["play"]];
  const [selected, setSelected] = useState<Control>("play");
  const press = useCallback(
    (control: Control) => {
      if (control === "close") onExit();
      else if (control === "back") seek(-1);
      else if (control === "forward") seek(1);
      else togglePause();
    },
    [onExit, seek, togglePause],
  );
  // Android reports remote keys on release (eventKeyAction 1) and, unless key-down events are on, only then.
  useTVEventHandler(
    useCallback(
      (event: { eventType: string; eventKeyAction?: number | undefined }) => {
        if (event.eventKeyAction === 0) return; // a key-down duplicate, if key-down events are ever enabled
        const key = event.eventType;
        if (key === "playPause") return togglePause();
        if (key === "rewind") return seek(-1);
        if (key === "fastForward") return seek(1);
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
      [chrome, press, selected, seek, togglePause, vod, wake],
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
    return (
      <Failure
        title={stream.title}
        message={explain(raw)}
        detail={raw}
        onRetry={() => {
          player.replace(stream.url);
          player.play();
        }}
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

  return (
    <View style={styles.player}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      {/* Something must hold focus or Android drops the remote's keys before they reach the app; the handler above does the acting. */}
      <Pressable focusable={tv} hasTVPreferredFocus={tv} style={StyleSheet.absoluteFill} onPress={tv ? undefined : () => (awake ? setAwake(false) : wake())} />

      {loading ? (
        <View style={styles.centreLayer} pointerEvents="none">
          <ActivityIndicator size={u(110)} color={colors.accent} />
        </View>
      ) : null}

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents={chrome ? "box-none" : "none"}>
        <View style={styles.top} pointerEvents="box-none">
          <Scrim from="top" />
          <RoundButton small selected={lit("close")} onPress={onExit}>
            <ChevronGlyph />
          </RoundButton>
          <View style={styles.titleBlock} pointerEvents="none">
            <Text style={styles.heading} numberOfLines={2}>
              {stream.title}
            </Text>
            {vod ? null : (
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </View>
          {vod && duration > 0 ? (
            <Text style={styles.endsAt} pointerEvents="none">
              Ends at {two(endsAt.getHours())}:{two(endsAt.getMinutes())}
            </Text>
          ) : null}
        </View>

        <View style={styles.bottom} pointerEvents="box-none">
          <Scrim from="bottom" />
          {vod ? (
            <View style={styles.timeline} pointerEvents="none">
              <Text style={styles.clock}>{clock(position)}</Text>
              <View style={[styles.track, lit("seek") && styles.trackLit]}>
                <View style={[styles.fillBuffered, { width: `${buffered * 100}%` }]} />
                <View style={[styles.fillPlayed, { width: `${ratio * 100}%` }]} />
                <View style={[styles.knob, lit("seek") && styles.knobLit, { left: `${ratio * 100}%` }]} />
              </View>
              <Text style={[styles.clock, styles.clockRight]}>-{clock(remaining)}</Text>
            </View>
          ) : null}

          <View style={styles.transport} pointerEvents="box-none">
            {vod ? (
              <RoundButton selected={lit("back")} active={flash === "back"} onPress={() => seek(-1)}>
                <SkipGlyph direction="back" />
              </RoundButton>
            ) : null}
            <RoundButton big selected={lit("play")} active={flash === "play"} onPress={togglePause}>
              {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
            </RoundButton>
            {vod ? (
              <RoundButton selected={lit("forward")} active={flash === "forward"} onPress={() => seek(1)}>
                <SkipGlyph direction="forward" />
              </RoundButton>
            ) : null}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/** A round button. On a TV the remote's highlight (`selected`) presses it; on a phone it is tapped. */
function RoundButton({
  big = false,
  small = false,
  selected = false,
  active = false,
  onPress,
  children,
}: {
  big?: boolean;
  small?: boolean;
  selected?: boolean;
  active?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      focusable={false}
      onPress={onPress}
      style={[
        styles.round,
        big ? styles.roundBig : small ? styles.roundTiny : styles.roundSmall,
        active && styles.roundActive,
        selected && styles.roundSelected,
        (selected || active) && { transform: [{ scale: big ? 1.08 : 1.14 }] },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** A darkening that fades out, built from stacked bands (no gradient library in the app). */
function Scrim({ from }: { from: "top" | "bottom" }) {
  const bands = 20;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: bands }, (_, index) => {
        const strength = from === "top" ? 1 - index / (bands - 1) : index / (bands - 1);
        return <View key={index} style={{ flex: 1, backgroundColor: `rgba(0,0,0,${(0.88 * strength ** 1.5).toFixed(3)})` }} />;
      })}
    </View>
  );
}

function ChevronGlyph() {
  return (
    <View
      style={{
        width: u(24),
        height: u(24),
        marginLeft: u(9),
        borderLeftWidth: u(6),
        borderBottomWidth: u(6),
        borderColor: colors.foreground,
        transform: [{ rotate: "45deg" }],
      }}
    />
  );
}

function PauseGlyph() {
  return (
    <View style={{ flexDirection: "row", gap: u(14) }}>
      <View style={{ width: u(16), height: u(54), backgroundColor: colors.accentInk, borderRadius: u(4) }} />
      <View style={{ width: u(16), height: u(54), backgroundColor: colors.accentInk, borderRadius: u(4) }} />
    </View>
  );
}

function PlayGlyph() {
  return (
    <View
      style={{
        marginLeft: u(10),
        width: 0,
        height: 0,
        borderTopWidth: u(30),
        borderBottomWidth: u(30),
        borderLeftWidth: u(50),
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: colors.accentInk,
      }}
    />
  );
}

/** "<10" / "10>": a small arrowhead and the number of seconds. */
function SkipGlyph({ direction }: { direction: "back" | "forward" }) {
  const head = (
    <View
      style={
        direction === "back"
          ? { width: 0, height: 0, borderTopWidth: u(14), borderBottomWidth: u(14), borderRightWidth: u(20), borderTopColor: "transparent", borderBottomColor: "transparent", borderRightColor: colors.foreground }
          : { width: 0, height: 0, borderTopWidth: u(14), borderBottomWidth: u(14), borderLeftWidth: u(20), borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: colors.foreground }
      }
    />
  );
  const label = <Text style={{ color: colors.foreground, fontSize: u(38), fontWeight: "700" }}>{SEEK_STEP_SECS}</Text>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: u(8) }}>
      {direction === "back" ? head : label}
      {direction === "back" ? label : head}
    </View>
  );
}

const styles = styleSheet({
  centre: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: space.l, padding: space.xl },
  row: { flexDirection: "row", gap: space.m },
  player: { flex: 1, backgroundColor: "#000" },
  centreLayer: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },

  top: { position: "absolute", left: 0, right: 0, top: 0, paddingHorizontal: 96, paddingTop: 56, paddingBottom: 130, flexDirection: "row", alignItems: "center", gap: 32 },
  titleBlock: { flex: 1, gap: 12 },
  heading: { color: colors.foreground, fontSize: 46, fontWeight: "700" },
  endsAt: { color: colors.muted, fontSize: 30, fontWeight: "500" },
  livePill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#000a", paddingHorizontal: 20, paddingVertical: 8, borderRadius: 10 },
  liveDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.live },
  liveText: { color: colors.foreground, fontSize: 28, fontWeight: "700", letterSpacing: 2 },

  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 96, paddingBottom: 64, paddingTop: 220, gap: 40 },
  timeline: { flexDirection: "row", alignItems: "center", gap: 32 },
  clock: { color: colors.foreground, fontSize: 32, fontWeight: "600", minWidth: 150 },
  clockRight: { textAlign: "right" },
  track: { flex: 1, height: 12, borderRadius: 6, backgroundColor: "#ffffff30", justifyContent: "center" },
  trackLit: { height: 20, borderRadius: 10 },
  fillBuffered: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 10, backgroundColor: "#ffffff55" },
  fillPlayed: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 10, backgroundColor: colors.accent },
  knob: { position: "absolute", width: 32, height: 32, borderRadius: 16, marginLeft: -16, backgroundColor: colors.foreground },
  knobLit: { width: 48, height: 48, borderRadius: 24, marginLeft: -24, borderWidth: 6, borderColor: colors.accent },

  transport: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 64 },
  round: { alignItems: "center", justifyContent: "center", borderRadius: 100, borderWidth: 6, borderColor: "transparent" },
  roundTiny: { width: 96, height: 96, backgroundColor: "#ffffff26" },
  roundSmall: { minWidth: 128, height: 128, paddingHorizontal: 20, backgroundColor: "#ffffff26" },
  roundBig: { width: 160, height: 160, backgroundColor: colors.foreground },
  roundActive: { backgroundColor: colors.accent },
  roundSelected: { borderColor: colors.accent, shadowColor: colors.accent, elevation: 12 },

  title: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: type.body },
  error: { color: colors.fault, fontSize: type.body, textAlign: "center", maxWidth: 900 },
  detail: { color: colors.faint, fontSize: type.small, textAlign: "center", maxWidth: 900 },
});
