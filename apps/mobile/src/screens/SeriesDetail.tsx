import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, FlatList, Image, Text, TVFocusGuideView, View } from "react-native";
import { getSeriesDetail, getSeriesSource, getUpNextEpisode } from "@testcard/core/src/db/seriesQueries.js";
import { ensureSeriesEpisodes } from "@testcard/core/src/db/importVodDetails.js";
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { getCredentials } from "../platform/secrets";
import { useApp } from "../state/app";
import { colors, type, styleSheet, uiScale } from "../theme";
import { BackArrow } from "../ui/BackArrow";
import { Muted } from "../ui/controls";
import { MenuRow } from "../ui/MenuRow";
import { Backdrop, DetailActions } from "../ui/DetailActions";
import { Focusable } from "../ui/Focusable";
import { episodeTitle, seriesTitle } from "../ui/titles";

/** "42m" / "1h 5m" from seconds. */
function runtime(secs: number): string {
  const minutes = Math.max(1, Math.round(secs / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** A series: seasons across the top, episodes below. Xtream episode lists are fetched on first open. Choosing an episode opens its page. */
export function SeriesDetailScreen({
  seriesId,
  title,
  onOpenEpisode,
  onPlayEpisode,
  onBack,
}: {
  seriesId: string;
  title: string;
  onOpenEpisode: (episodeId: string, title: string) => void;
  onPlayEpisode: (episodeId: string, title: string, resume: boolean) => void;
  onBack: () => void;
}) {
  const { db, version } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [seasonId, setSeasonId] = useState<string>();
  const pickSeason = useCallback((id: string) => setSeasonId(id), []);

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
  // Open on the season with something left to watch, and on its first unwatched episode.
  const firstUnwatched = seasons.find((season) => season.episodes.some((episode) => episode.watched !== 1)) ?? seasons[0];
  const active = seasons.find((season) => season.id === seasonId) ?? firstUnwatched;
  const episodes = active?.episodes ?? [];
  const nextIndex = Math.max(0, episodes.findIndex((episode) => episode.watched !== 1));
  const seasonLabel = (season: { name: string | null; season_number: number }) => season.name ?? `Season ${season.season_number}`;
  const rowLength = Math.round(EPISODE_ROW * uiScale);
  // The big button: carry on with what you were watching, else the first episode you have not seen.
  const upNext = useMemo(() => (loading ? undefined : getUpNextEpisode(db, seriesId)), [db, seriesId, version, loading]);
  const upNextResume = upNext?.resume ?? false;

  return (
    <View style={styles.screen}>
      <Backdrop uri={detail?.series.poster_url ?? null} />
      <View style={styles.head}>
        <BackArrow onPress={onBack} />
        <View style={styles.headText}>
          <Text style={styles.title} numberOfLines={1}>
            {seriesTitle(title)}
          </Text>
          {detail?.series.plot ? (
            <Text style={styles.plot} numberOfLines={2}>
              {detail.series.plot}
            </Text>
          ) : null}
          {upNext !== undefined ? (
            <DetailActions
              primary={{
                label: `${upNextResume ? "Resume" : "Play"} S${upNext.season.season_number} E${upNext.episode.episode_number}`,
                onPress: () => onPlayEpisode(upNext.episode.id, `${seriesTitle(title)} · ${episodeTitle(upNext.episode.name)}`, upNextResume),
                progress:
                  upNextResume && upNext.episode.position_secs !== null && upNext.episode.duration_secs !== null && upNext.episode.duration_secs > 0
                    ? upNext.episode.position_secs / upNext.episode.duration_secs
                    : undefined,
              }}
              actions={[]}
            />
          ) : null}
        </View>
      </View>
      {error !== undefined ? (
        <Text style={styles.error}>{error}</Text>
      ) : loading ? (
        <Muted>Loading episodes...</Muted>
      ) : seasons.length === 0 ? (
        <Muted>This series has no episodes.</Muted>
      ) : (
        <View style={styles.body}>
          {seasons.length > 1 ? (
            <TVFocusGuideView autoFocus style={styles.seasons}>
              {seasons.map((season) => (
                <MenuRow key={season.id} id={season.id} label={seasonLabel(season)} active={season.id === active?.id} onPressId={pickSeason} onFocusId={pickSeason} />
              ))}
            </TVFocusGuideView>
          ) : null}
          <TVFocusGuideView autoFocus style={styles.episodes}>
            <FlatList
              key={active?.id}
              data={episodes}
              keyExtractor={(episode) => episode.id}
              showsVerticalScrollIndicator={false}
              initialScrollIndex={nextIndex > 2 ? nextIndex - 1 : 0}
              getItemLayout={(_, index) => ({ length: rowLength, offset: rowLength * index, index })}
              renderItem={({ item: episode, index }) => {
                const started = episode.position_secs !== null && shouldPromptResume(episode.position_secs, episode.duration_secs);
                const done = episode.watched === 1;
                const ratio = started && episode.position_secs !== null && episode.duration_secs !== null && episode.duration_secs > 0 ? Math.min(1, episode.position_secs / episode.duration_secs) : 0;
                return (
                  <Focusable
                    preferred={false}
                    focusedStyle={styles.episodeFocused}
                    onPress={() => onOpenEpisode(episode.id, `${seriesTitle(title)} · ${episodeTitle(episode.name)}`)}
                    style={styles.episode}
                  >
                    <Text style={styles.number}>{episode.episode_number}</Text>
                    <View style={styles.thumb}>
                      {episode.image_url ? <Image source={{ uri: episode.image_url }} style={styles.thumbImage} resizeMode="cover" resizeMethod="resize" fadeDuration={0} /> : null}
                      {ratio > 0 ? (
                        <View style={styles.progress}>
                          <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.episodeBody}>
                      <View style={styles.episodeTop}>
                        <Text style={[styles.episodeName, done && styles.episodeDone]} numberOfLines={1}>
                          {episodeTitle(episode.name)}
                        </Text>
                        {episode.duration_secs !== null && episode.duration_secs > 0 ? <Text style={styles.length}>{runtime(episode.duration_secs)}</Text> : null}
                      </View>
                      {episode.plot ? (
                        <Text style={styles.episodePlot} numberOfLines={2}>
                          {episode.plot}
                        </Text>
                      ) : null}
                      {started ? <Text style={styles.state}>Resume</Text> : done ? <Text style={styles.watched}>Watched</Text> : null}
                    </View>
                  </Focusable>
                );
              }}
            />
          </TVFocusGuideView>
        </View>
      )}
    </View>
  );
}

const EPISODE_ROW = 138;

const styles = styleSheet({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 120, paddingTop: 44, gap: 28 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 32 },
  headText: { flex: 1, gap: 8, paddingTop: 2 },
  title: { color: colors.foreground, fontSize: 52, fontWeight: "600", letterSpacing: -1 },
  plot: { color: colors.muted, fontSize: 24, lineHeight: 34, maxWidth: 1200 },
  body: { flex: 1, flexDirection: "row", gap: 36 },
  seasons: { width: 300 },
  episodes: { flex: 1 },
  episode: { height: 128, flexDirection: "row", alignItems: "center", gap: 24, paddingHorizontal: 24, backgroundColor: "#ffffff0d", borderRadius: 16, marginBottom: 10 },
  episodeFocused: { backgroundColor: "#ffffff24", borderColor: "transparent", transform: [{ scale: 1.01 }] },
  number: { color: colors.faint, fontSize: 28, width: 36, textAlign: "center" },
  thumb: { width: 208, height: 117, borderRadius: 10, backgroundColor: colors.raised, overflow: "hidden", justifyContent: "flex-end" },
  thumbImage: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  progress: { height: 5, backgroundColor: "#00000080" },
  progressFill: { height: 5, backgroundColor: colors.accent },
  episodeBody: { flex: 1, gap: 6 },
  episodeTop: { flexDirection: "row", alignItems: "center", gap: 16 },
  episodeName: { flex: 1, color: colors.foreground, fontSize: 27, fontWeight: "500" },
  episodeDone: { color: colors.muted },
  episodePlot: { color: colors.muted, fontSize: 21, lineHeight: 29 },
  length: { color: colors.muted, fontSize: 22 },
  state: { color: colors.accent, fontSize: 21, fontWeight: "500" },
  watched: { color: colors.faint, fontSize: 21 },
  error: { color: colors.fault, fontSize: type.body },
});
