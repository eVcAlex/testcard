import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Text, TVFocusGuideView, View } from "react-native";
import { Image } from "expo-image";
import { MIN_SEARCH_LENGTH, searchAll, type SearchResults } from "@testcard/core/src/db/searchQueries.js";
import type { ChannelRow } from "@testcard/core/src/db/queries.js";
import { useApp } from "../state/app";
import { colors, styleSheet } from "../theme";
import { Field } from "../ui/controls";
import { Focusable } from "../ui/Focusable";
import { PosterRow, type PosterItem } from "../ui/Poster";

/** What was typed last, so coming back from a film's page lands on the same results. */
let remembered = "";

type Section = { key: "movies"; items: PosterItem[] } | { key: "series"; items: PosterItem[] } | { key: "channels"; items: ChannelRow[] };

/**
 * One search box for everything: films, series and live channels, updating as you type. Select on the box opens
 * the system keyboard, on the TV as on a phone.
 */
export function SearchScreen({
  sourceId,
  onOpenMovie,
  onOpenSeries,
  onPlayChannel,
}: {
  sourceId: string | null;
  onOpenMovie: (movie: { id: string; title: string }) => void;
  onOpenSeries: (series: { id: string; title: string }) => void;
  onPlayChannel: (channel: { id: string; title: string }, channels: readonly { id: string; title: string }[]) => void;
}) {
  const { db, version } = useApp();
  const [query, setQueryState] = useState(remembered);
  const setQuery = useCallback((next: string) => {
    remembered = next;
    setQueryState(next);
  }, []);

  const [results, setResults] = useState<SearchResults | null>(null);
  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_SEARCH_LENGTH) {
      setResults(null);
      return;
    }
    // A moment after the last key, so typing stays quick and only the finished word is looked up.
    const timer = setTimeout(() => setResults(searchAll(db, text, { ...(sourceId !== null ? { sourceId } : {}) })), 200);
    return () => clearTimeout(timer);
  }, [db, version, query, sourceId]);

  const sections = useMemo<Section[]>(() => {
    if (results === null) return [];
    const list: Section[] = [];
    if (results.movies.length > 0)
      list.push({
        key: "movies",
        items: results.movies.map((movie) => ({
          id: movie.id,
          name: movie.name,
          posterUrl: movie.poster_url,
          progress: movie.position_secs !== null && movie.duration_secs !== null && movie.duration_secs > 0 ? movie.position_secs / movie.duration_secs : null,
        })),
      });
    if (results.series.length > 0) list.push({ key: "series", items: results.series.map((show) => ({ id: show.id, name: show.name, posterUrl: show.poster_url, progress: null })) });
    if (results.channels.length > 0) list.push({ key: "channels", items: results.channels });
    return list;
  }, [results]);

  const openMovie = useCallback((item: PosterItem) => onOpenMovie({ id: item.id, title: item.name }), [onOpenMovie]);
  const openSeries = useCallback((item: PosterItem) => onOpenSeries({ id: item.id, title: item.name }), [onOpenSeries]);
  const channels = results?.channels ?? [];
  const playChannel = useCallback(
    (channel: ChannelRow) => onPlayChannel({ id: channel.id, title: channel.normalised_name }, channels.map((entry) => ({ id: entry.id, title: entry.normalised_name }))),
    [onPlayChannel, channels],
  );

  const renderSection = useCallback(
    ({ item }: { item: Section }) => {
      if (item.key === "movies") return <PosterRow title={`Movies  ${item.items.length}`} items={item.items} onPress={openMovie} />;
      if (item.key === "series") return <PosterRow title={`Series  ${item.items.length}`} items={item.items} onPress={openSeries} />;
      return <ChannelSection channels={item.items} onPress={playChannel} />;
    },
    [openMovie, openSeries, playChannel],
  );

  const short = query.trim().length < MIN_SEARCH_LENGTH;
  return (
    <View style={styles.screen}>
      <View style={styles.left}>
        <Field label="Search" preferred value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
      </View>
      <TVFocusGuideView autoFocus style={styles.right}>
        {sections.length > 0 ? (
          <FlatList data={sections} keyExtractor={(section) => section.key} renderItem={renderSection} showsVerticalScrollIndicator={false} windowSize={5} contentContainerStyle={styles.list} />
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{short ? "Search movies, series and channels" : results === null ? "" : `Nothing found for "${query.trim()}"`}</Text>
            {short ? <Text style={styles.emptyHint}>Type at least two letters. Results appear as you go.</Text> : null}
          </View>
        )}
      </TVFocusGuideView>
    </View>
  );
}

function ChannelSection({ channels, onPress }: { channels: readonly ChannelRow[]; onPress: (channel: ChannelRow) => void }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{`Channels  ${channels.length}`}</Text>
      <FlatList
        horizontal
        data={channels}
        keyExtractor={(channel) => channel.id}
        renderItem={({ item }) => <ChannelTile channel={item} onPress={onPress} />}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={4}
        windowSize={5}
        contentContainerStyle={styles.channelList}
      />
    </View>
  );
}

function ChannelTile({ channel, onPress }: { channel: ChannelRow; onPress: (channel: ChannelRow) => void }) {
  return (
    <Focusable onPress={() => onPress(channel)} style={styles.channel} focusedStyle={styles.channelFocused}>
      <View style={styles.logo}>
        {channel.logo_url !== null && channel.logo_url !== "" ? <Image source={{ uri: channel.logo_url }} style={styles.logoImage} contentFit="contain" cachePolicy="memory-disk" recyclingKey={channel.id} /> : null}
      </View>
      <Text style={styles.channelName} numberOfLines={2}>
        {channel.normalised_name}
      </Text>
    </Focusable>
  );
}

const styles = styleSheet({
  screen: { flex: 1, flexDirection: "row", gap: 40 },
  left: { width: 570, gap: 22 },
  right: { flex: 1 },
  list: { paddingBottom: 80 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTitle: { color: colors.muted, fontSize: 34, fontWeight: "500" },
  emptyHint: { color: colors.faint, fontSize: 24 },
  section: { gap: 12, marginBottom: 24 },
  sectionTitle: { color: colors.foreground, fontSize: 32, fontWeight: "600", letterSpacing: -0.3, paddingLeft: 8 },
  channelList: { gap: 16, paddingVertical: 8, paddingHorizontal: 8 },
  channel: { width: 360, flexDirection: "row", alignItems: "center", gap: 16, padding: 14, backgroundColor: colors.raised, borderRadius: 16 },
  channelFocused: { backgroundColor: "#ffffff24", borderColor: "transparent" },
  logo: { width: 96, height: 64, borderRadius: 10, backgroundColor: colors.sunken, overflow: "hidden" },
  logoImage: { width: "100%", height: "100%" },
  channelName: { flex: 1, color: colors.foreground, fontSize: 24, fontWeight: "500" },
});
