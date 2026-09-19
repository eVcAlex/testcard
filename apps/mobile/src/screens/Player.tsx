import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Platform, Pressable, StyleSheet, Text, useTVEventHandler, View } from "react-native";
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
import { Focusable } from "../ui/Focusable";

const SEEK_STEP_SECS = 10;
const SEEK_HELD_SECS = 30;
const HELD_WITHIN_MS = 350;
const CHROME_HIDES_AFTER_MS = 4000;
const PROGRESS_EVERY_MS = 5000;

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

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
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
      wake();
    },
    [duration, player, vod, wake],
  );
  const togglePause = useCallback(() => {
    if (player.playing) player.pause();
    else player.play();
    wake();
  }, [player, wake]);

  // Android reports remote keys on release (eventKeyAction 1) and, unless key-down events are on, only then.
  useTVEventHandler(
    useCallback(
      (event: { eventType: string; eventKeyAction?: number | undefined }) => {
        if (event.eventKeyAction === 0) return; // a key-down duplicate, if key-down events are ever enabled
        switch (event.eventType) {
          case "left":
          case "rewind":
            return seek(-1);
          case "right":
          case "fastForward":
            return seek(1);
          case "up":
          case "down":
            return wake();
          case "playPause":
            return togglePause();
        }
      },
      [seek, togglePause, wake],
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
  const tv = Platform.isTV;

  return (
    <View style={styles.player}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      <Pressable
        focusable
        hasTVPreferredFocus
        style={StyleSheet.absoluteFill}
        onPress={() => (tv ? togglePause() : awake ? setAwake(false) : wake())}
      />

      {loading ? (
        <View style={styles.centreLayer} pointerEvents="none">
          <Text style={styles.badge}>Loading...</Text>
        </View>
      ) : !isPlaying ? (
        <View style={styles.centreLayer} pointerEvents="none">
          <View style={styles.pausedDisc}>
            <PauseGlyph />
          </View>
        </View>
      ) : null}

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents={chrome ? "box-none" : "none"}>
        <View style={styles.top} pointerEvents="none">
          <Scrim from="top" />
          <Text style={styles.heading} numberOfLines={1}>
            {stream.title}
          </Text>
          {vod ? null : (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>

        <View style={styles.bottom} pointerEvents="box-none">
          <Scrim from="bottom" />
          {vod ? (
            <View style={styles.timeline} pointerEvents="none">
              <Text style={styles.clock}>{clock(position)}</Text>
              <View style={styles.track}>
                <View style={[styles.fillBuffered, { width: `${buffered * 100}%` }]} />
                <View style={[styles.fillPlayed, { width: `${ratio * 100}%` }]} />
                <View style={[styles.knob, { left: `${ratio * 100}%` }]} />
              </View>
              <Text style={styles.clock}>{clock(duration)}</Text>
            </View>
          ) : null}

          {tv ? (
            <Text style={styles.hint} pointerEvents="none">
              {vod ? "Left / Right  seek 10s      OK  play or pause      Back  close" : "OK  play or pause      Back  close"}
            </Text>
          ) : (
            <View style={styles.controls}>
              {vod ? (
                <Focusable style={styles.round} onPress={() => seek(-1)}>
                  <Text style={styles.roundLabel}>-{SEEK_STEP_SECS}</Text>
                </Focusable>
              ) : null}
              <Focusable preferred style={[styles.round, styles.roundMain]} onPress={togglePause}>
                {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
              </Focusable>
              {vod ? (
                <Focusable style={styles.round} onPress={() => seek(1)}>
                  <Text style={styles.roundLabel}>+{SEEK_STEP_SECS}</Text>
                </Focusable>
              ) : null}
              <Focusable style={styles.round} onPress={onExit}>
                <Text style={styles.roundLabel}>Close</Text>
              </Focusable>
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

/** A darkening that fades out, built from stacked bands (no gradient library in the app). */
function Scrim({ from }: { from: "top" | "bottom" }) {
  const bands = 16;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: bands }, (_, index) => {
        const strength = from === "top" ? 1 - index / (bands - 1) : index / (bands - 1);
        return <View key={index} style={{ flex: 1, backgroundColor: `rgba(0,0,0,${(0.85 * strength ** 1.6).toFixed(3)})` }} />;
      })}
    </View>
  );
}

function PauseGlyph() {
  return (
    <View style={{ flexDirection: "row", gap: u(10) }}>
      <View style={{ width: u(12), height: u(38), backgroundColor: colors.foreground, borderRadius: u(3) }} />
      <View style={{ width: u(12), height: u(38), backgroundColor: colors.foreground, borderRadius: u(3) }} />
    </View>
  );
}

function PlayGlyph() {
  return (
    <View
      style={{
        marginLeft: u(6),
        width: 0,
        height: 0,
        borderTopWidth: u(20),
        borderBottomWidth: u(20),
        borderLeftWidth: u(32),
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: colors.foreground,
      }}
    />
  );
}

const styles = styleSheet({
  centre: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: space.l, padding: space.xl },
  row: { flexDirection: "row", gap: space.m },
  player: { flex: 1, backgroundColor: "#000" },
  centreLayer: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  badge: { color: colors.foreground, fontSize: type.lead, fontWeight: "600", backgroundColor: "#000a", paddingHorizontal: space.xl, paddingVertical: space.m, borderRadius: 12 },
  pausedDisc: { width: 120, height: 120, borderRadius: 60, backgroundColor: "#000b", alignItems: "center", justifyContent: "center" },

  top: { position: "absolute", left: 0, right: 0, top: 0, paddingHorizontal: space.xl, paddingTop: space.l, paddingBottom: 80, flexDirection: "row", alignItems: "center", gap: space.m },
  heading: { flexShrink: 1, color: colors.foreground, fontSize: type.lead, fontWeight: "700" },
  livePill: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#000a", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  liveDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.live },
  liveText: { color: colors.foreground, fontSize: type.small, fontWeight: "700", letterSpacing: 1.5 },

  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.xl, paddingBottom: space.l, paddingTop: 120, gap: space.m },
  timeline: { flexDirection: "row", alignItems: "center", gap: space.m },
  clock: { color: colors.foreground, fontSize: type.small, fontWeight: "600", minWidth: 90, textAlign: "center" },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "#ffffff30", justifyContent: "center" },
  fillBuffered: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: "#ffffff50" },
  fillPlayed: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: colors.accent },
  knob: { position: "absolute", width: 22, height: 22, borderRadius: 11, marginLeft: -11, backgroundColor: colors.foreground },
  hint: { color: colors.muted, fontSize: type.small, textAlign: "center" },

  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.l },
  round: { minWidth: 76, height: 76, borderRadius: 38, paddingHorizontal: space.m, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff24" },
  roundMain: { minWidth: 96, height: 96, borderRadius: 48, backgroundColor: "#ffffff38" },
  roundLabel: { color: colors.foreground, fontSize: type.body, fontWeight: "700" },

  title: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: type.body },
  error: { color: colors.fault, fontSize: type.body, textAlign: "center", maxWidth: 900 },
  detail: { color: colors.faint, fontSize: type.small, textAlign: "center", maxWidth: 900 },
});
