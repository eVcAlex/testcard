import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, FlatList, Text, TVFocusGuideView, View } from "react-native";
import { Image } from "expo-image";
import { splitTitle } from "@testcard/core/src/normalise/splitTitle.js";
import { getSeriesDetail, getSeriesSource, getUpNextEpisode, removeSeriesFromRecents, toggleSeriesFavourite } from "@testcard/core/src/db/seriesQueries.js";
import { ensureSeriesEpisodes } from "@testcard/core/src/db/importVodDetails.js";
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { getCredentials } from "../platform/secrets";
import { useApp } from "../state/app";
import { colors, type, styleSheet, uiScale } from "../theme";
import { BackArrow } from "../ui/BackArrow";
import { Muted } from "../ui/controls";
import { Backdrop, DetailActions, Facts, type DetailAction } from "../ui/DetailActions";
import { Focusable } from "../ui/Focusable";
import { Pill } from "../ui/Pill";
import { episodeTitle, seriesTitle } from "../ui/titles";

/** "42m" / "1h 5m" from seconds. */
function runtime(secs: number): string {
  const minutes = Math.max(1, Math.round(secs / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** "12:34" / "1:02:03" from seconds, for where a resume picked up. */
function position(secs: number): string {
  const total = Math.max(0, Math.floor(secs));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A film frame when the provider has no artwork for an episode: a quiet stand-in instead of a blank box. */
function FilmGlyph() {
  return (
    <View style={styles.placeholder}>
      <View style={styles.filmHoles}>
        <View style={styles.filmHole} />
        <View style={styles.filmHole} />
        <View style={styles.filmHole} />
      </View>
      <View style={styles.filmFrame}>
        <View style={styles.playTriangle} />
      </View>
    </View>
  );
}

/**
 * A series: poster and what you can do with it, seasons across the top, episodes below as a grid of
 * cards. Xtream episode lists are fetched on first open. Choosing an episode opens its page.
 */
export function SeriesDetailScreen({
  seriesId,
  title,
  onPlayEpisode,
  onBack,
}: {
  seriesId: string;
  title: string;
  onPlayEpisode: (episodeId: string, title: string, resume: boolean) => void;
  onBack: () => void;
}) {
  const { db, sync, version, updateStatus } = useApp();
  const [tick, setTick] = useState(0);
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
    void tick;
    return loading ? undefined : getSeriesDetail(db, seriesId);
  }, [db, seriesId, version, tick, loading]);

  const seasons = detail?.seasons ?? [];
  const series = detail?.series;
  // Open on the season with something left to watch, and on its first unwatched episode.
  const firstUnwatched = seasons.find((season) => season.episodes.some((episode) => episode.watched !== 1)) ?? seasons[0];
  const active = seasons.find((season) => season.id === seasonId) ?? firstUnwatched;
  const episodes = active?.episodes ?? [];
  const nextIndex = Math.max(0, episodes.findIndex((episode) => episode.watched !== 1));
  const seasonLabel = (season: { name: string | null; season_number: number }) => season.name ?? `Season ${season.season_number}`;
  // The big button: carry on with what you were watching, else the first episode you have not seen.
  const upNext = useMemo(() => (loading ? undefined : getUpNextEpisode(db, seriesId)), [db, seriesId, version, loading]);
  const upNextResume = upNext?.resume ?? false;

  // Episodes are a grid like the app's posters: several cards to a row, sized to fit the screen width.
  const [gridWidth, setGridWidth] = useState(0);
  const GRID_GAP = 28;
  const MIN_CARD = 340;
  const gridDesign = gridWidth / uiScale;
  const columns = gridDesign > 0 ? Math.min(6, Math.max(2, Math.floor((gridDesign + GRID_GAP) / (MIN_CARD + GRID_GAP)))) : 4;
  const cardWidth = gridDesign > 0 ? (gridDesign - GRID_GAP * (columns - 1)) / columns : MIN_CARD;
  const thumbHeight = (cardWidth * 9) / 16;
  const ROW = thumbHeight + 108;
  const cardDp = (n: number) => Math.round(n * uiScale);

  return (
    <View style={styles.screen}>
      <Backdrop uri={series?.poster_url ?? null} />
      <View style={styles.head}>
        <View style={styles.poster}>
          {series?.poster_url !== null && series?.poster_url !== undefined && series?.poster_url !== "" ? <Image source={{ uri: series.poster_url }} style={styles.posterImage} contentFit="cover" cachePolicy="memory-disk" /> : null}
        </View>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {seriesTitle(title)}
          </Text>
          <Facts facts={factsOf(detail)} />
          {series?.plot && series.plot !== "" ? (
            <Text style={styles.plot} numberOfLines={3}>
              {series.plot}
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
                  }
            }
            actions={[
              ...(upNextResume && upNext !== undefined
                ? [{ key: "restart", label: "Start over", glyph: "restart" as const, onPress: () => onPlayEpisode(upNext.episode.id, `${seriesTitle(title)} · ${episodeTitle(upNext.episode.name)}`, false) }]
                : []),
              ...(series !== undefined
                ? [
                    {
                      key: "list",
                      label: series.is_favourite === 1 ? "Remove from My list" : "Add to My list",
                      glyph: (series.is_favourite === 1 ? "check" : "plus") satisfies "check" | "plus",
                      onPress: () => {
                        toggleSeriesFavourite(db, seriesId);
                        sync.notifyLocalChange();
                        setTick((value) => value + 1);
                      },
                    } as DetailAction,
                  ]
                : []),
              ...(upNext !== undefined
                ? [
                    {
                      key: "remove",
                      label: "Remove from Continue watching",
                      glyph: "cross" as const,
                      onPress: () => {
                        removeSeriesFromRecents(db, seriesId);
                        sync.notifyLocalChange();
                        updateStatus();
                        onBack();
                      },
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
        </View>
        <View style={styles.back}>
          <BackArrow onPress={onBack} />
        </View>
      </View>
      {error !== undefined ? (
        <Text style={styles.error}>{error}</Text>
      ) : loading ? (
        <Muted>Loading episodes...</Muted>
      ) : seasons.length === 0 ? (
        <Muted>This series has no episodes.</Muted>
      ) : (
        <TVFocusGuideView style={styles.body}>
          {seasons.length > 1 ? (
            <TVFocusGuideView style={styles.seasons}>
              <FlatList
                horizontal
                data={seasons}
                keyExtractor={(season) => season.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.seasonList}
                renderItem={({ item: season }) => <Pill id={season.id} label={seasonLabel(season)} active={season.id === active?.id} onPressId={pickSeason} />}
              />
            </TVFocusGuideView>
          ) : null}
          <TVFocusGuideView autoFocus style={styles.episodes}>
            <FlatList
              key={`${active?.id}-${columns}`}
              data={episodes}
              keyExtractor={(episode) => episode.id}
              numColumns={columns}
              columnWrapperStyle={{ gap: cardDp(GRID_GAP) }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.episodeList}
              onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
              initialScrollIndex={gridDesign > 0 && nextIndex > columns * 2 ? Math.max(0, Math.floor(nextIndex / columns) - 1) : 0}
              getItemLayout={(_, index) => ({ length: cardDp(ROW), offset: Math.floor(index / columns) * cardDp(ROW), index })}
              renderItem={({ item: episode }) => {
                const started = episode.position_secs !== null && shouldPromptResume(episode.position_secs, episode.duration_secs);
                const done = episode.watched === 1;
                const ratio = started && episode.position_secs !== null && episode.duration_secs !== null && episode.duration_secs > 0 ? Math.min(1, episode.position_secs / episode.duration_secs) : 0;
                const duration = episode.duration_secs !== null && episode.duration_secs > 0 ? runtime(episode.duration_secs) : "";
                return (
                  <Focusable preferred={false} onPress={() => onPlayEpisode(episode.id, `${seriesTitle(title)} · ${episodeTitle(episode.name)}`, started)} style={styles.card} focusedStyle={styles.cardFocused}>
                    {({ focused }) => (
                      <>
                        <View style={[styles.thumb, focused && styles.thumbFocused, { width: cardDp(cardWidth), height: cardDp(thumbHeight) }]}>
                          {episode.image_url ? <Image source={{ uri: episode.image_url }} style={styles.thumbImage} contentFit="cover" cachePolicy="memory-disk" recyclingKey={episode.id} /> : <FilmGlyph />}
                          <Text style={styles.cardNumber}>E{episode.episode_number}</Text>
                          {done ? (
                            <View style={styles.watchedBadge}>
                              <Text style={styles.watchedMark}>{"✓"}</Text>
                            </View>
                          ) : null}
                          {ratio > 0 ? (
                            <View style={styles.progress}>
                              <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
                            </View>
                          ) : null}
                        </View>
                        <Text style={[styles.cardTitle, focused && styles.cardTitleFocused, done && styles.cardTitleDone]} numberOfLines={1}>
                          {episodeTitle(episode.name)}
                        </Text>
                        <Text style={[styles.cardMeta, done ? styles.metaDone : started && styles.metaResume]}>
                          {done ? (duration !== "" ? `${duration}  ·  Watched` : "Watched") : started && episode.position_secs !== null ? `Resume from ${position(episode.position_secs)}` : duration}
                        </Text>
                      </>
                    )}
                  </Focusable>
                );
              }}
            />
          </TVFocusGuideView>
        </TVFocusGuideView>
      )}
    </View>
  );
}

/** The year, how many seasons and episodes, and the rating, for the Facts row like the other detail pages. */
function factsOf(detail: { series: { name: string; rating: string | number | null }; seasons: readonly { episodes: readonly unknown[] }[] } | undefined): string[] {
  if (detail === undefined) return [];
  const { year } = splitTitle(detail.series.name);
  const episodeCount = detail.seasons.reduce((total, season) => total + season.episodes.length, 0);
  const rating = detail.series.rating !== null && Number(detail.series.rating) > 0 && Number(detail.series.rating) < 10 ? Number(detail.series.rating).toFixed(1) : null;
  return [year || null, detail.seasons.length > 0 ? `${detail.seasons.length} ${detail.seasons.length === 1 ? "season" : "seasons"}` : null, episodeCount > 0 ? `${episodeCount} episodes` : null, rating !== null ? `${rating} rating` : null].filter((fact): fact is string => fact !== null && fact !== "");
}

const styles = styleSheet({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 120, paddingTop: 44, gap: 34 },
  head: { flexDirection: "row", alignItems: "center", gap: 56, paddingTop: 10 },
  back: { position: "absolute", left: 0, top: 0, elevation: 40, zIndex: 2 },
  poster: { width: 360, aspectRatio: 2 / 3, borderRadius: 20, backgroundColor: colors.raised, overflow: "hidden", elevation: 24 },
  posterImage: { width: "100%", height: "100%" },
  info: { flex: 1, gap: 18 },
  title: { color: colors.foreground, fontSize: 56, fontWeight: "600", letterSpacing: -1 },
  plot: { color: colors.muted, fontSize: 26, lineHeight: 38, maxWidth: 1000 },
  body: { flex: 1, gap: 24 },
  seasons: {},
  seasonList: { gap: 14, paddingVertical: 4 },
  episodes: { flex: 1 },
  episodeList: { gap: 30, paddingBottom: 28 },
  card: { gap: 8 },
  cardFocused: { borderColor: "transparent" },
  thumb: { borderRadius: 12, borderWidth: 3, borderColor: "transparent", backgroundColor: colors.raised, overflow: "hidden", justifyContent: "flex-end" },
  thumbFocused: { borderColor: colors.accent },
  thumbImage: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  cardNumber: { position: "absolute", left: 12, top: 10, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, backgroundColor: "#000000b3", color: colors.foreground, fontSize: 18, fontWeight: "600" },
  watchedBadge: { position: "absolute", right: 12, top: 10, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#000000b3" },
  watchedMark: { color: colors.accent, fontSize: 18, fontWeight: "700" },
  progress: { height: 5, backgroundColor: "#00000080" },
  progressFill: { height: 5, backgroundColor: colors.accent },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  filmHoles: { flexDirection: "row", gap: 14 },
  filmHole: { width: 14, height: 10, borderRadius: 2, backgroundColor: "#ffffff18" },
  filmFrame: { width: 68, height: 68, borderRadius: 34, borderWidth: 3, borderColor: "#ffffff40", alignItems: "center", justifyContent: "center" },
  playTriangle: { width: 0, height: 0, borderTopWidth: 15, borderBottomWidth: 15, borderLeftWidth: 25, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: "#ffffff55", marginLeft: 5 },
  cardTitle: { color: colors.muted, fontSize: 24, fontWeight: "500" },
  cardTitleFocused: { color: colors.foreground },
  cardTitleDone: { opacity: 0.6 },
  cardMeta: { color: colors.faint, fontSize: 21 },
  metaResume: { color: colors.accent },
  metaDone: { color: colors.faint },
  error: { color: colors.fault, fontSize: type.body },
});