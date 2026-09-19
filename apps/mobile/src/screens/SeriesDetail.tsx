import { useEffect, useMemo, useState } from "react";
import { BackHandler, FlatList, Text, View } from "react-native";
import { getSeriesDetail, getSeriesSource, type EpisodeRow } from "@testcard/core/src/db/seriesQueries.js";
import { ensureSeriesEpisodes } from "@testcard/core/src/db/importVodDetails.js";
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { getCredentials } from "../platform/secrets";
import { useApp } from "../state/app";
import { colors, space, type, styleSheet } from "../theme";
import { Button, Heading, Muted } from "../ui/controls";
import { Focusable } from "../ui/Focusable";

export interface EpisodePlay {
  readonly id: string;
  readonly title: string;
  readonly seriesId: string;
  readonly resume: boolean;
}

/** A series: seasons across the top, episodes below. Xtream episode lists are fetched on first open. */
export function SeriesDetailScreen({ seriesId, title, onPlay, onBack }: { seriesId: string; title: string; onPlay: (episode: EpisodePlay) => void; onBack: () => void }) {
  const { db, version } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [seasonId, setSeasonId] = useState<string>();

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const source = getSeriesSource(db, seriesId);
      if (source?.kind === "xtream") await ensureSeriesEpisodes(db, source, seriesId, getCredentials);
    })()
      .catch((failure: unknown) => !cancelled && setError(failure instanceof Error ? failure.message : "The episodes could not be loaded."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [db, seriesId]);

  const detail = useMemo(() => {
    void version;
    return loading ? undefined : getSeriesDetail(db, seriesId);
  }, [db, seriesId, version, loading]);

  const seasons = detail?.seasons ?? [];
  // Open on the season with something left to watch.
  const firstUnwatched = seasons.find((season) => season.episodes.some((episode) => episode.watched !== 1)) ?? seasons[0];
  const active = seasons.find((season) => season.id === seasonId) ?? firstUnwatched;

  const playEpisode = (episode: EpisodeRow) =>
    onPlay({
      id: episode.id,
      title: episode.name,
      seriesId,
      resume: episode.position_secs !== null && shouldPromptResume(episode.position_secs, episode.duration_secs),
    });

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Button label="Back" onPress={onBack} />
        <Heading>{title}</Heading>
      </View>
      {error !== undefined ? (
        <Text style={styles.error}>{error}</Text>
      ) : loading ? (
        <Muted>Loading episodes...</Muted>
      ) : seasons.length === 0 ? (
        <Muted>This series has no episodes.</Muted>
      ) : (
        <>
          <FlatList
            horizontal
            data={seasons}
            keyExtractor={(season) => season.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.seasons}
            renderItem={({ item: season }) => (
              <Focusable onPress={() => setSeasonId(season.id)} style={[styles.chip, season.id === active?.id && styles.chipActive]}>
                <Text style={[styles.chipLabel, season.id === active?.id && styles.chipLabelActive]}>{season.name ?? `Season ${season.season_number}`}</Text>
              </Focusable>
            )}
          />
          <FlatList
            data={active?.episodes ?? []}
            keyExtractor={(episode) => episode.id}
            renderItem={({ item: episode }) => (
              <Focusable onPress={() => playEpisode(episode)} style={styles.episode}>
                <Text style={styles.number}>{episode.episode_number}</Text>
                <Text style={styles.episodeName} numberOfLines={1}>
                  {episode.name}
                </Text>
                <Text style={styles.state}>
                  {episode.position_secs !== null && shouldPromptResume(episode.position_secs, episode.duration_secs) ? "Resume" : episode.watched === 1 ? "Watched" : ""}
                </Text>
              </Focusable>
            )}
          />
        </>
      )}
    </View>
  );
}

const styles = styleSheet({
  screen: { flex: 1, backgroundColor: colors.background, padding: space.xl, gap: space.l },
  head: { flexDirection: "row", alignItems: "center", gap: space.l },
  seasons: { gap: space.m, paddingVertical: space.s },
  chip: { paddingVertical: space.s, paddingHorizontal: space.l, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.accentSoft },
  chipLabel: { color: colors.muted, fontSize: type.body },
  chipLabelActive: { color: colors.accent },
  episode: { flexDirection: "row", alignItems: "center", gap: space.l, paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: colors.card, marginBottom: space.s },
  number: { color: colors.faint, fontSize: type.body, width: 48 },
  episodeName: { flex: 1, color: colors.foreground, fontSize: type.body },
  state: { color: colors.accent, fontSize: type.small },
  error: { color: colors.fault, fontSize: type.body },
});
