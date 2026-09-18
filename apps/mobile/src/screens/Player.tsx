import { useEffect, useRef, useState } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { setPlaybackProgress } from "@testcard/core/src/db/progressQueries.js";
import { recordRecent } from "@testcard/core/src/db/queries.js";
import { recordMovieRecent } from "@testcard/core/src/db/vodQueries.js";
import { recordSeriesRecent } from "@testcard/core/src/db/seriesQueries.js";
import { resolveStream, type PlayItem, type ResolvedStream } from "../playback/resolveStream";
import { useApp } from "../state/app";
import { colors, space, type } from "../theme";
import { Button } from "../ui/controls";

const SEEK_STEP_SECS = 10;
const PROGRESS_EVERY_MS = 5000;

/**
 * Fullscreen playback. The buttons along the bottom take the D-pad (Pause has focus first); Back leaves.
 * Position is saved every few seconds so "continue watching" and sync have something to carry.
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

  if (error !== undefined) {
    return (
      <View style={styles.centre}>
        <Text style={styles.error}>{error}</Text>
        <Button preferred label="Back" onPress={onExit} />
      </View>
    );
  }
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

function Playing({ item, stream, seriesId, onExit }: { item: PlayItem; stream: ResolvedStream; seriesId?: string; onExit: () => void }) {
  const { db } = useApp();
  const vod = item.kind !== "channel";
  const [paused, setPaused] = useState(false);
  const started = useRef(false);

  const player = useVideoPlayer(stream.url, (instance) => {
    instance.timeUpdateEventInterval = 1;
    if (stream.resumeSecs !== null) instance.currentTime = stream.resumeSecs;
    instance.play();
  });

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
      const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : null;
      if (player.currentTime > 0) setPlaybackProgress(db, item.kind as "movie" | "episode", item.id, Math.floor(player.currentTime), duration === null ? null : Math.floor(duration));
    };
    const timer = setInterval(save, PROGRESS_EVERY_MS);
    return () => {
      clearInterval(timer);
      save();
    };
  }, [db, item, player, seriesId, vod]);

  function togglePause() {
    if (paused) player.play();
    else player.pause();
    setPaused(!paused);
  }

  return (
    <View style={styles.player}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      {paused ? (
        <View style={styles.surface} pointerEvents="none">
          <Text style={styles.badge}>Paused</Text>
        </View>
      ) : null}
      <View style={styles.bar} pointerEvents="box-none">
        <Text style={styles.title} numberOfLines={1}>
          {stream.title}
        </Text>
        <View style={styles.barActions}>
          {vod && <Button label={`Back ${SEEK_STEP_SECS}s`} onPress={() => (player.currentTime = Math.max(0, player.currentTime - SEEK_STEP_SECS))} />}
          <Button preferred label={paused ? "Play" : "Pause"} onPress={togglePause} />
          {vod && <Button label={`Forward ${SEEK_STEP_SECS}s`} onPress={() => (player.currentTime = player.currentTime + SEEK_STEP_SECS)} />}
          <Button label="Close" onPress={onExit} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: space.l },
  player: { flex: 1, backgroundColor: "#000" },
  surface: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  badge: { color: colors.foreground, fontSize: type.title, fontWeight: "700", backgroundColor: "#000a", paddingHorizontal: space.xl, paddingVertical: space.m, borderRadius: 12 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: space.l, gap: space.m, backgroundColor: "#05080bcc" },
  barActions: { flexDirection: "row", gap: space.m },
  title: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: type.body },
  error: { color: colors.fault, fontSize: type.body, textAlign: "center", maxWidth: 900 },
});
