import { useEffect, useMemo } from "react";
import { BackHandler, Image, Text, View } from "react-native";
import { getSeriesDetail } from "@testcard/core/src/db/seriesQueries.js";
import { clearPlaybackProgress } from "@testcard/core/src/db/progressQueries.js";
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { useApp } from "../state/app";
import { colors, styleSheet } from "../theme";
import { BackArrow } from "../ui/BackArrow";
import { Backdrop, DetailActions, Facts } from "../ui/DetailActions";
import { Button } from "../ui/controls";
import { episodeTitle, seriesTitle } from "../ui/titles";

/** "1h 36m" / "42m" from seconds. */
function runtime(secs: number): string {
  const minutes = Math.round(secs / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** "1:23:45" / "23:45" from seconds. */
function position(secs: number): string {
  const total = Math.max(0, Math.floor(secs));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** One episode's own page: what it is, and what you can do with it (play, resume, start over). */
export function EpisodeDetailScreen({ seriesId, episodeId, onPlay, onBack }: { seriesId: string; episodeId: string; onPlay: (resume: boolean) => void; onBack: () => void }) {
  const { db, sync, version, updateStatus } = useApp();

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  const found = useMemo(() => {
    void version;
    const detail = getSeriesDetail(db, seriesId);
    if (detail === undefined) return undefined;
    for (const season of detail.seasons) {
      const episode = season.episodes.find((entry) => entry.id === episodeId);
      if (episode !== undefined) return { series: detail.series, season, episode };
    }
    return undefined;
  }, [db, seriesId, episodeId, version]);

  if (found === undefined) {
    return (
      <View style={styles.screen}>
        <Text style={styles.plot}>That episode is no longer in your library.</Text>
        <Button preferred label="Back" onPress={onBack} />
      </View>
    );
  }

  const { series, season, episode } = found;
  const resume = episode.position_secs !== null && shouldPromptResume(episode.position_secs, episode.duration_secs);
  const facts = [`Season ${season.season_number}, episode ${episode.episode_number}`, episode.duration_secs !== null && episode.duration_secs > 0 ? runtime(episode.duration_secs) : null, episode.watched === 1 ? "Watched" : null].filter(
    (fact): fact is string => fact !== null,
  );
  const poster = season.poster_url ?? series.poster_url;

  return (
    <View style={styles.screen}>
      <Backdrop uri={episode.image_url ?? poster} />
      <View style={styles.back}>
        <BackArrow onPress={onBack} />
      </View>
      <View style={styles.poster}>{poster !== null && poster !== "" ? <Image source={{ uri: poster }} style={styles.posterImage} resizeMode="cover" resizeMethod="resize" fadeDuration={0} /> : null}</View>
      <View style={styles.info}>
        <Text style={styles.series} numberOfLines={1}>
          {seriesTitle(series.name)}
        </Text>
        <Text style={styles.title} numberOfLines={3}>
          {episodeTitle(episode.name)}
        </Text>
        <Facts facts={facts} />
        {episode.plot !== null && episode.plot !== "" ? (
          <Text style={styles.plot} numberOfLines={4}>
            {episode.plot}
          </Text>
        ) : null}
        <DetailActions
          primary={{ label: resume && episode.position_secs !== null ? `Resume from ${position(episode.position_secs)}` : "Play", onPress: () => onPlay(resume), progress: resume && episode.position_secs !== null && episode.duration_secs !== null && episode.duration_secs > 0 ? episode.position_secs / episode.duration_secs : undefined }}
          actions={
            resume
              ? [
                  { key: "restart", label: "Start over", glyph: "restart" as const, onPress: () => onPlay(false) },
                  {
                    key: "clear",
                    label: "Clear progress",
                    glyph: "cross" as const,
                    onPress: () => {
                      clearPlaybackProgress(db, "episode", [episodeId]);
                      sync.notifyLocalChange();
                      updateStatus();
                    },
                  },
                ]
              : []
          }
        />
      </View>
    </View>
  );
}

const styles = styleSheet({
  screen: { flex: 1, backgroundColor: colors.background, flexDirection: "row", alignItems: "center", gap: 72, paddingHorizontal: 120 },
  poster: { width: 460, aspectRatio: 2 / 3, borderRadius: 20, backgroundColor: colors.raised, overflow: "hidden", elevation: 24 },
  posterImage: { width: "100%", height: "100%" },
  info: { flex: 1, gap: 24 },
  series: { color: colors.accent, fontSize: 28, fontWeight: "500" },
  title: { color: colors.foreground, fontSize: 56, fontWeight: "600", letterSpacing: -1 },
  plot: { color: colors.muted, fontSize: 28, lineHeight: 42, maxWidth: 1000 },
  back: { position: "absolute", left: 60, top: 44 },
});
