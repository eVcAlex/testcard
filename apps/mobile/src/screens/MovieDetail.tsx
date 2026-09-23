import { useEffect, useMemo, useState } from "react";
import { BackHandler, Text, View } from "react-native";
import { Image } from "expo-image";
import { splitTitle } from "@testcard/core/src/normalise/splitTitle.js";
import { getMovieById, getMoviePlaybackTarget, listMovieVersions, removeMovieFromHistory, toggleMovieFavourite } from "@testcard/core/src/db/vodQueries.js";
import { ensureMovieDetails } from "@testcard/core/src/db/importVodDetails.js";
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { getCredentials } from "../platform/secrets";
import { useApp } from "../state/app";
import { colors, styleSheet } from "../theme";
import { BackArrow } from "../ui/BackArrow";
import { Backdrop, DetailActions, Facts } from "../ui/DetailActions";
import { Button } from "../ui/controls";
import { OptionsSheet } from "../ui/OptionsSheet";
import { setWatched } from "@testcard/core/src/db/progressQueries.js";

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

/**
 * A film's own page: poster, what it is, and what you can do with it (play, resume, start over, add to
 * My list). Its plot and length are fetched from the provider the first time it is opened.
 */
export function MovieDetailScreen({
  movieId,
  onPlay,
  onBack,
  onOpenVersion,
}: {
  movieId: string;
  onPlay: (resume: boolean) => void;
  onBack: () => void;
  /** Opens another copy of this film (another quality or source) in place of this one. */
  onOpenVersion: (movie: { id: string; title: string }) => void;
}) {
  const { db, sync, version, updateStatus, sources } = useApp();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  const movie = useMemo(() => {
    void version;
    void tick;
    return getMovieById(db, movieId);
  }, [db, movieId, version, tick]);

  const needsDetails = movie !== undefined && movie.details_fetched_at === null;

  // The same film filed again by the provider (a 4K copy, a "TOP" list) or offered by another source: the lists show
  // it once, and this is where the other copies are picked from.
  const versions = useMemo(() => listMovieVersions(db, movieId), [db, movieId]);
  const [choosingVersion, setChoosingVersion] = useState(false);
  const versionLabel = (row: { name: string; source_id: string }) => {
    const tag = /^(.{1,12}?)\s+-\s+/.exec(row.name.trim())?.[1];
    // Named only when the copies come from more than one source; otherwise every line would say the same thing.
    const mixed = versions.some((entry) => entry.source_id !== movie?.source_id);
    const source = mixed ? sources.find((entry) => entry.id === row.source_id)?.name : undefined;
    return [splitTitle(row.name).is4k ? "4K" : "HD", tag !== undefined && tag !== "4K" ? tag.replace(/^4K-?/, "") : undefined, source].filter((part) => part !== undefined && part !== "").join("  ·  ");
  };
  useEffect(() => {
    if (!needsDetails) return;
    const target = getMoviePlaybackTarget(db, movieId);
    if (target === undefined || target.source.kind !== "xtream") return;
    let cancelled = false;
    ensureMovieDetails(db, target.source, movieId, getCredentials)
      .then(() => !cancelled && setTick((value) => value + 1))
      .catch(() => undefined); // the page works without a plot
    return () => {
      cancelled = true;
    };
  }, [db, movieId, needsDetails]);

  if (movie === undefined) {
    return (
      <View style={styles.screen}>
        <Text style={styles.plot}>That movie is no longer in your library.</Text>
        <Button preferred label="Back" onPress={onBack} />
      </View>
    );
  }

  const { title, year } = splitTitle(movie.name);
  const resume = movie.position_secs !== null && shouldPromptResume(movie.position_secs, movie.duration_secs);
  const rating = movie.rating !== null && Number(movie.rating) > 0 && Number(movie.rating) < 10 ? Number(movie.rating).toFixed(1) : null;
  const facts = [year, movie.duration_secs !== null && movie.duration_secs > 0 ? runtime(movie.duration_secs) : null, rating !== null ? `${rating} rating` : null].filter((fact): fact is string => fact !== null && fact !== "");

  return (
    <View style={styles.screen}>
      <Backdrop uri={movie.poster_url} />
      <View style={styles.back}>
        <BackArrow onPress={onBack} />
      </View>
      <View style={styles.poster}>
        {movie.poster_url !== null && movie.poster_url !== "" ? <Image source={{ uri: movie.poster_url }} style={styles.posterImage} contentFit="cover" cachePolicy="memory-disk" /> : null}
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={3}>
          {title}
        </Text>
        <Facts facts={facts} />
        {movie.plot !== null && movie.plot !== "" ? (
          <Text style={styles.plot} numberOfLines={4}>
            {movie.plot}
          </Text>
        ) : null}
        <DetailActions
          primary={{ label: resume && movie.position_secs !== null ? `Resume from ${position(movie.position_secs)}` : "Play", onPress: () => onPlay(resume), progress: resume && movie.position_secs !== null && movie.duration_secs !== null && movie.duration_secs > 0 ? movie.position_secs / movie.duration_secs : undefined }}
          actions={[
            ...(resume ? [{ key: "restart", label: "Start over", glyph: "restart" as const, onPress: () => onPlay(false) }] : []),
            {
              key: "list",
              label: movie.is_favourite === 1 ? "Remove from My list" : "Add to My list",
              glyph: movie.is_favourite === 1 ? ("check" as const) : ("plus" as const),
              onPress: () => {
                toggleMovieFavourite(db, movieId);
                sync.notifyLocalChange();
                setTick((value) => value + 1);
              },
            },
            {
              key: "watched",
              label: movie.watched === 1 ? "Mark as unwatched" : "Mark as watched",
              glyph: movie.watched === 1 ? ("unwatched" as const) : ("watched" as const),
              onPress: () => {
                setWatched(db, "movie", [movieId], movie.watched !== 1);
                sync.notifyLocalChange();
                setTick((value) => value + 1);
              },
            },
            ...(versions.length > 0 ? [{ key: "versions", label: `Other versions (${versions.length})`, glyph: "versions" as const, onPress: () => setChoosingVersion(true) }] : []),
            ...(resume
              ? [
                  {
                    key: "remove",
                    label: "Remove from Continue watching",
                    glyph: "cross" as const,
                    onPress: () => {
                      removeMovieFromHistory(db, movieId);
                      sync.notifyLocalChange();
                      updateStatus();
                      onBack();
                    },
                  },
                ]
              : []),
          ]}
        />
      </View>
      {choosingVersion ? (
        <OptionsSheet
          title={`Other versions of ${title}`}
          options={versions.map((row) => ({ id: row.id, label: versionLabel(row) }))}
          onChoose={(id) => {
            const row = versions.find((entry) => entry.id === id);
            if (row !== undefined) onOpenVersion({ id: row.id, title: row.name });
          }}
          onClose={() => setChoosingVersion(false)}
        />
      ) : null}
    </View>
  );
}

const styles = styleSheet({
  screen: { flex: 1, backgroundColor: colors.background, flexDirection: "row", alignItems: "center", gap: 72, paddingHorizontal: 120 },
  poster: { width: 460, aspectRatio: 2 / 3, borderRadius: 20, backgroundColor: colors.raised, overflow: "hidden", elevation: 24 },
  posterImage: { width: "100%", height: "100%" },
  info: { flex: 1, gap: 24 },
  title: { color: colors.foreground, fontSize: 72, fontWeight: "600", letterSpacing: -1.5 },
  plot: { color: colors.muted, fontSize: 28, lineHeight: 42, maxWidth: 1000 },
  back: { position: "absolute", left: 24, top: 44 },
});
