import { useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FlatList, Platform, Text, TextInput, TVFocusGuideView, View } from "react-native";
import { ChannelLogo } from "../ui/ChannelLogo";
import { Search } from "iconoir-react-native";
import { MIN_SEARCH_LENGTH, searchAll, type SearchResults } from "@testcard/core/src/db/searchQueries.js";
import type { ChannelRow } from "@testcard/core/src/db/queries.js";
import { useApp } from "../state/app";
import { colors, styleSheet, uiScale } from "../theme";
import { Focusable } from "../ui/Focusable";
import { PosterRow, SourceNames, type PosterItem } from "../ui/Poster";

/** What was typed last, so coming back from a film's page lands on the same results. */
let remembered = "";

type Section = { key: "movies"; items: PosterItem[] } | { key: "series"; items: PosterItem[] } | { key: "channels"; items: ChannelRow[] };

const u = (n: number) => Math.round(n * uiScale);

/**
 * One search box for everything: films, series and live channels, updating as you type. Opening Search from the
 * nav bar opens the system keyboard straight away; select on the box opens it again.
 */
export function SearchScreen({
  sourceId,
  openKeyboard,
  onOpenMovie,
  onOpenSeries,
  onPlayChannel,
}: {
  sourceId: string | null;
  /** Bumped each time Search is chosen in the nav bar: the keyboard opens, ready to type. */
  openKeyboard: number;
  onOpenMovie: (movie: { id: string; title: string }) => void;
  onOpenSeries: (series: { id: string; title: string }) => void;
  onPlayChannel: (channel: { id: string; title: string }, channels: readonly { id: string; title: string }[]) => void;
}) {
  const { db, version, sources } = useApp();
  const [query, setQueryState] = useState(remembered);
  const setQuery = useCallback((next: string) => {
    remembered = next;
    setQueryState(next);
  }, []);

  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (openKeyboard === 0) return;
    // A moment's wait: the pane was hidden until this render, and a hidden field cannot take focus.
    const timer = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [openKeyboard]);

  const [results, setResults] = useState<SearchResults | null>(null);
  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_SEARCH_LENGTH) {
      setResults(null);
      return;
    }
    // A moment after the last key, so typing stays quick and only the finished word is looked up.
    const timer = setTimeout(() => setResults(searchAll(db, text, sourceId !== null ? { sourceId } : {})), 200);
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

  // Results from more than one source name theirs on each poster and channel, so the same film from two
  // providers can be told apart. One source's results need no label.
  const sourceNames = useMemo(() => {
    if (results === null) return null;
    const ids = new Set([...results.movies, ...results.series].map((entry) => entry.id.slice(0, Math.max(0, entry.id.indexOf(":")))));
    for (const channel of results.channels) ids.add(channel.source_id);
    return ids.size > 1 ? new Map(sources.map((entry) => [entry.id, entry.name])) : null;
  }, [results, sources]);

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
        <SearchBar inputRef={input} value={query} onChangeText={setQuery} />
      </View>
      <TVFocusGuideView autoFocus style={styles.right}>
        {sections.length > 0 ? (
          <SourceNames.Provider value={sourceNames}>
            <FlatList data={sections} keyExtractor={(section) => section.key} renderItem={renderSection} showsVerticalScrollIndicator={false} windowSize={5} contentContainerStyle={styles.list} extraData={sourceNames} />
          </SourceNames.Provider>
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

/**
 * The search box. On a TV it is a focus stop that opens the keyboard on select (so moving past it never throws the
 * keyboard up); focused, it takes the accent ring every other focus stop in the app has.
 */
function SearchBar({ inputRef, value, onChangeText }: { inputRef: RefObject<TextInput | null>; value: string; onChangeText: (text: string) => void }) {
  const tv = Platform.isTV;
  const [typing, setTyping] = useState(false);
  const bar = (focused: boolean) => (
    <>
      <Search color={focused || typing ? colors.foreground : colors.muted} width={u(30)} height={u(30)} strokeWidth={1.75} />
      <TextInput
        ref={inputRef}
        focusable={!tv}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
        placeholder="Movies, series, channels"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        underlineColorAndroid="transparent"
        selectionColor={colors.accent}
        style={styles.input}
      />
    </>
  );
  if (!tv) return <View style={[styles.bar, typing && styles.barFocused]}>{bar(false)}</View>;
  return (
    <Focusable preferred onPress={() => inputRef.current?.focus()} style={[styles.bar, typing && styles.barFocused]} focusedStyle={styles.barFocused}>
      {({ focused }) => bar(focused)}
    </Focusable>
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
  const sourceName = useContext(SourceNames)?.get(channel.source_id);
  return (
    <Focusable onPress={() => onPress(channel)} style={styles.channel} focusedStyle={styles.channelFocused}>
      <View style={styles.logo}>
        <ChannelLogo url={channel.logo_url} name={channel.normalised_name} size={24} recyclingKey={channel.id} />
      </View>
      <View style={styles.channelText}>
        <Text style={styles.channelName} numberOfLines={sourceName !== undefined ? 1 : 2}>
          {channel.normalised_name}
        </Text>
        {sourceName !== undefined ? (
          <Text style={styles.channelSource} numberOfLines={1}>
            {sourceName}
          </Text>
        ) : null}
      </View>
    </Focusable>
  );
}

const styles = styleSheet({
  screen: { flex: 1, flexDirection: "row", gap: 40 },
  left: { width: 570, gap: 22 },
  bar: { height: 76, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 26, borderRadius: 38, borderColor: colors.border, backgroundColor: colors.raised },
  barFocused: { borderColor: colors.accent, backgroundColor: colors.card },
  input: { flex: 1, height: "100%", padding: 0, color: colors.foreground, fontSize: 28 },
  right: { flex: 1 },
  list: { paddingBottom: 80 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTitle: { color: colors.muted, fontSize: 34, fontWeight: "500" },
  emptyHint: { color: colors.faint, fontSize: 24 },
  section: { gap: 12, marginBottom: 24 },
  sectionTitle: { color: colors.foreground, fontSize: 32, fontWeight: "600", letterSpacing: -0.3, paddingLeft: 8 },
  channelList: { gap: 16, paddingVertical: 8, paddingHorizontal: 8 },
  channel: { width: 360, flexDirection: "row", alignItems: "center", gap: 16, padding: 14, backgroundColor: colors.raised, borderRadius: 16 },
  channelFocused: { backgroundColor: colors.card },
  logo: { width: 96, height: 64, borderRadius: 10, backgroundColor: colors.sunken, overflow: "hidden" },
  channelText: { flex: 1, gap: 2 },
  channelName: { color: colors.foreground, fontSize: 24, fontWeight: "500" },
  channelSource: { color: colors.muted, fontSize: 19, fontWeight: "500" },
});
