import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Easing, FlatList, Text, TVFocusGuideView, View } from "react-native";
import { Image } from "expo-image";
import { Check, Movie } from "iconoir-react-native";
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

const INK = "#0b0e10";

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
      <Movie color="#ffffff40" width={44} height={44} strokeWidth={1.5} />
    </View>
  );
}

/** A slow native pulse for the loading outlines, so it keeps going while the episode list is being written. */
function usePulse() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 1, 0.45] });
}

/** Where the buttons will be, while the episodes (which the big button depends on) load. */
function ActionsSkeleton() {
  const opacity = usePulse();
  return (
    <Animated.View style={[styles.skeletonActions, { opacity }]} pointerEvents="none">
      <View style={styles.skeletonPrimary} />
      {[0, 1, 2].map((key) => (
        <View key={key} style={styles.skeletonCircle} />
      ))}
    </Animated.View>
  );
}

/** The shape of the season pills and episode cards, sized like the real grid, while the episode list is fetched. */
function EpisodesSkeleton({ columns, cardWidth, thumbHeight, onWidth }: { columns: number; cardWidth: number; thumbHeight: number; onWidth: (width: number) => void }) {
  const opacity = usePulse();
  const dp = (n: number) => Math.round(n * uiScale);
  return (
    <Animated.View style={[styles.body, { opacity }]} pointerEvents="none" onLayout={(event) => onWidth(event.nativeEvent.layout.width)}>
      <View style={styles.skeletonPills}>
        {[150, 150, 150].map((width, key) => (
          <View key={key} style={[styles.skeletonPill, { width: dp(width) }]} />
        ))}
      </View>
      <View style={[styles.skeletonGrid, { columnGap: dp(28) }]}>
        {Array.from({ length: columns * 2 }, (_, key) => (
          // Rounded down: rounding each card up can push the last one of a row onto the next.
          <View key={key} style={[styles.card, { width: Math.floor(cardWidth * uiScale) }]}>
            <View style={[styles.skeletonThumb, { height: dp(thumbHeight) }]} />
            <View style={[styles.skeletonLine, { width: dp(cardWidth * 0.7) }]} />
            <View style={[styles.skeletonLine, styles.skeletonLineShort, { width: dp(cardWidth * 0.35) }]} />
          </View>
        ))}
      </View>
    </Animated.View>
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

  // Read straight away, not after the episode fetch: the poster, plot and rating are already stored, so the page
  // shows them while the episodes load (and re-reads once they have).
  const detail = useMemo(() => {
    void version;
    void tick;
    void loading;
    return getSeriesDetail(db, seriesId);
  }, [db, seriesId, version, tick, loading]);

  const seasons = detail?.seasons ?? [];
  const series = detail?.series;
  // The big button: carry on with what you were watching, else the first episode you have not seen.
  const upNext = useMemo(() => (loading ? undefined : getUpNextEpisode(db, seriesId)), [db, seriesId, version, loading]);
  const upNextResume = upNext?.resume ?? false;
  // Opens on the season Resume points to, so the highlighted pill always agrees with the big button
  // (rather than a separately computed "first unwatched" that could land on a different season).
  const active = seasons.find((season) => season.id === seasonId) ?? seasons.find((season) => season.id === upNext?.season.id) ?? seasons[0];
  const episodes = active?.episodes ?? [];
  const nextIndex = Math.max(0, episodes.findIndex((episode) => episode.watched !== 1));
  const seasonLabel = (season: { name: string | null; season_number: number }) => season.name ?? `Season ${season.season_number}`;

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

  // The row the remote is on is brought to the top of the grid, so the row above is not left cut through under the
  // season pills (its "Resume from" line hanging there with no card).
  const gridRef = useRef<FlatList<(typeof episodes)[number]>>(null);
  const gridRow = useRef(-1);
  // A row's real height (a card plus the gap below it), measured from the first card: the estimate (ROW) drifts
  // a few pixels a row, which adds up down a long season.
  const measuredRow = useRef<number | undefined>(undefined);
  useEffect(() => {
    gridRow.current = -1;
  }, [active?.id, columns]);
  const alignEpisodeRow = (index: number) => {
    const row = Math.floor(index / columns);
    if (gridRow.current === row) return;
    gridRow.current = row;
    gridRef.current?.scrollToOffset({ offset: row * (measuredRow.current ?? cardDp(ROW)), animated: true });
  };

  return (
    <View style={styles.screen}>
      <Backdrop uri={series?.poster_url ?? null} />
      <View style={styles.back}>
        <BackArrow onPress={onBack} />
      </View>
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
        ) : loading && error === undefined ? (
          <ActionsSkeleton />
        ) : null}
        </View>
      </View>
      {error !== undefined ? (
        <Text style={styles.error}>{error}</Text>
      ) : loading ? (
        <EpisodesSkeleton columns={columns} cardWidth={cardWidth} thumbHeight={thumbHeight} onWidth={setGridWidth} />
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
              ref={gridRef}
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
              renderItem={({ item: episode, index }) => {
                const started = episode.position_secs !== null && shouldPromptResume(episode.position_secs, episode.duration_secs);
                const done = episode.watched === 1;
                const ratio = started && episode.position_secs !== null && episode.duration_secs !== null && episode.duration_secs > 0 ? Math.min(1, episode.position_secs / episode.duration_secs) : 0;
                const duration = episode.duration_secs !== null && episode.duration_secs > 0 ? runtime(episode.duration_secs) : "";
                return (
                  <Focusable
                    preferred={false}
                    onLayout={index === 0 ? (event) => (measuredRow.current = event.nativeEvent.layout.height + cardDp(30)) : undefined}
                    onFocus={() => alignEpisodeRow(index)} onPress={() => onPlayEpisode(episode.id, `${seriesTitle(title)} · ${episodeTitle(episode.name)}`, started)} style={styles.card} focusedStyle={styles.cardFocused}>
                    {({ focused }) => (
                      <>
                        <View style={[styles.thumb, focused && styles.thumbFocused, { width: cardDp(cardWidth), height: cardDp(thumbHeight) }]}>
                          {episode.image_url ? <Image source={{ uri: episode.image_url }} style={styles.thumbImage} contentFit="cover" cachePolicy="memory-disk" recyclingKey={episode.id} /> : <FilmGlyph />}
                          {done ? <View style={styles.thumbDone} pointerEvents="none" /> : null}
                          <Text style={styles.cardNumber}>E{episode.episode_number}</Text>
                          {done ? (
                            <View style={styles.watchedBadge}>
                              <Check color={INK} width={18} height={18} strokeWidth={3} />
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
  // In the page's left margin, clear of the poster (which starts at the 120 padding), level with its top edge.
  back: { position: "absolute", left: 24, top: 44, elevation: 40, zIndex: 2 },
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
  // A solid accent-filled badge (not just an outline) and a dimmed thumbnail so a watched episode reads
  // at a glance, the way Netflix greys out a finished card instead of relying on a small corner mark.
  thumbDone: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#00000099" },
  watchedBadge: { position: "absolute", right: 10, top: 8, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  progress: { height: 5, backgroundColor: "#00000080" },
  progressFill: { height: 5, backgroundColor: colors.accent },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: colors.muted, fontSize: 24, fontWeight: "500" },
  cardTitleFocused: { color: colors.foreground },
  cardTitleDone: { opacity: 0.6 },
  cardMeta: { color: colors.faint, fontSize: 21 },
  metaResume: { color: colors.accent },
  metaDone: { color: colors.faint },
  error: { color: colors.fault, fontSize: type.body },
  skeletonActions: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 6 },
  skeletonPrimary: { width: 250, height: 68, borderRadius: 34, backgroundColor: colors.cardActive },
  skeletonCircle: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.card },
  skeletonPills: { flexDirection: "row", gap: 14, paddingVertical: 4 },
  skeletonPill: { height: 52, borderRadius: 26, backgroundColor: colors.card },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 30 },
  skeletonThumb: { borderRadius: 12, backgroundColor: colors.card },
  skeletonLine: { height: 22, borderRadius: 6, marginTop: 6, backgroundColor: colors.cardActive },
  skeletonLineShort: { height: 18, marginTop: 2, backgroundColor: colors.card },
});