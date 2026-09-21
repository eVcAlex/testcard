import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Text, TVFocusGuideView, View } from "react-native";
import { genreOptions } from "@testcard/core/src/normalise/genres.js";
import { colors, space, type, styleSheet, uiScale } from "../theme";
import { Muted } from "../ui/controls";
import { Focusable } from "../ui/Focusable";
import { MenuRow, ROW_HEIGHT, withCommas } from "../ui/MenuRow";
import { PosterCard, type PosterItem } from "../ui/Poster";

/** Something to pick in the grid: a film or series poster, or a channel. */
export interface BrowseItem {
  readonly id: string;
  readonly title: string;
  readonly imageUrl: string | null;
  /** 0 to 1 when started and not finished. */
  readonly progress?: number | null;
  readonly number?: number | null;
  /** A film that has a saved position worth offering to resume. */
  readonly resume?: boolean;
}

/** What is on a channel: the programme airing and the one after it. Either can be missing. */
export interface Guide {
  readonly now: { readonly title: string; readonly start: number; readonly end: number } | null;
  readonly next: { readonly title: string; readonly start: number } | null;
}

export type Selection = {
  readonly kind: "special" | "category" | "genre";
  readonly key: string;
};

export interface BrowseSource {
  /** How the grid draws an item. */
  readonly layout: "poster" | "channel";
  /** "movies", "series", "channels": used for the empty message and the header count. */
  readonly noun: string;
  /** The same word for exactly one: "movie", "series", "channel". */
  readonly single: string;
  /** Fixed entries at the top of the list (continue watching, my list, history, all). Empty ones are hidden except "all". */
  readonly specials: readonly { key: string; label: string; count: number }[];
  readonly categories: readonly {
    id: string;
    label: string;
    count: number;
    genre: string | null;
  }[];
  /** The items for a selection, at most `limit` of them. Synchronous: it is a local database read. */
  readonly load: (selection: Selection, limit: number) => BrowseItem[];
  /** What is on a channel right now. Asked of the provider, so only for the channel the remote rests on. */
  readonly guide?: (id: string) => Promise<Guide | null>;
}

type Entry =
  | {
      readonly kind: "row";
      readonly id: string;
      readonly label: string;
      readonly count: number;
      readonly selection: Selection;
      readonly indent: boolean;
    }
  | {
      readonly kind: "genres";
      readonly id: "genres";
      readonly label: string;
      readonly count: number;
    };

const GENRES_ID = "genres";
/** The category each section had open, so coming back from a film or the player lands where you were. */
const remembered = new Map<string, { id: string; selection: Selection }>();
const PAGE = 60;
const MAX_ITEMS = 600;
/** How long the remote must rest on a category before it opens, so scrolling past dozens does not load dozens. */
const OPEN_AFTER_MS = 160;
const rowHeight = Math.round(ROW_HEIGHT * uiScale);
/** How long the remote must rest on a channel before its guide is asked for. */
const GUIDE_AFTER_MS = 350;
/** A channel's guide is good for this long before it is asked for again. */
const GUIDE_FRESH_MS = 5 * 60 * 1000;

/** "21:05". `toLocaleTimeString` is not dependable on every Hermes build. */
const clock = (ms: number): string => {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/**
 * Categories down the left, what is in the highlighted one on the right (the TiviMate layout, with the
 * desktop app's categories, counts and genres). Everything is a plain read of the local database; only the
 * rows on screen are drawn.
 */
export function BrowseScreen({ source, empty, onSelect }: { source: BrowseSource; empty: string; onSelect: (item: BrowseItem, list: readonly BrowseItem[]) => void }) {
  const genres = useMemo(
    () =>
      genreOptions(
        source.categories.map((category) => ({
          genre: category.genre,
          count: category.count,
        })),
      ),
    [source],
  );
  const [genresOpen, setGenresOpen] = useState(false);

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    for (const special of source.specials) {
      if (special.count > 0 || special.key === "all")
        list.push({
          kind: "row",
          id: `s:${special.key}`,
          label: special.label,
          count: special.count,
          selection: { kind: "special", key: special.key },
          indent: false,
        });
    }
    if (genres.length > 0) {
      list.push({
        kind: "genres",
        id: GENRES_ID,
        label: "Genres",
        count: genres.length,
      });
      if (genresOpen)
        for (const genre of genres)
          list.push({
            kind: "row",
            id: `g:${genre.genre}`,
            label: genre.label,
            count: genre.count,
            selection: { kind: "genre", key: genre.genre },
            indent: true,
          });
    }
    for (const category of source.categories)
      list.push({
        kind: "row",
        id: `c:${category.id}`,
        label: category.label,
        count: category.count,
        selection: { kind: "category", key: category.id },
        indent: false,
      });
    return list;
  }, [source, genres, genresOpen]);

  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const first = entries.find((entry) => entry.kind === "row" && entry.count > 0);
  const [open, setOpenState] = useState<{ id: string; selection: Selection } | undefined>(() => remembered.get(source.noun));
  const setOpen = useCallback(
    (next: { id: string; selection: Selection }) => {
      remembered.set(source.noun, next);
      setOpenState(next);
    },
    [source.noun],
  );
  // Until the user picks, show the first entry that has something in it.
  // The remembered category can be gone (an emptied Continue watching): fall back to the first one.
  const current = (open !== undefined && byId.has(open.id) ? open : undefined) ?? (first !== undefined && first.kind === "row" ? { id: first.id, selection: first.selection } : undefined);
  const shown = useDeferredValue(current);

  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [shown?.id]);

  const items = useMemo(() => (shown === undefined ? [] : source.load(shown.selection, limit)), [source, shown, limit]);
  const shownEntry = shown !== undefined ? byId.get(shown.id) : undefined;

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const openEntry = useCallback(
    (id: string) => {
      const entry = byId.get(id);
      if (entry?.kind === "row") setOpen({ id, selection: entry.selection });
    },
    [byId, setOpen],
  );
  const onFocusId = useCallback(
    (id: string) => {
      clearTimeout(timer.current);
      if (byId.get(id)?.kind === "row") timer.current = setTimeout(() => openEntry(id), OPEN_AFTER_MS);
    },
    [byId, openEntry],
  );
  const onPressId = useCallback(
    (id: string) => {
      clearTimeout(timer.current);
      if (id === GENRES_ID) setGenresOpen((value) => !value);
      else openEntry(id);
    },
    [openEntry],
  );

  const activeId = current?.id;
  const renderMenuItem = useCallback(
    ({ item: entry }: { item: Entry }) =>
      entry.kind === "genres" ? (
        <MenuRow id={entry.id} label={entry.label} open={genresOpen} onPressId={onPressId} />
      ) : (
        <MenuRow id={entry.id} label={entry.label} indent={entry.indent} active={entry.id === activeId} onPressId={onPressId} onFocusId={onFocusId} />
      ),
    [activeId, genresOpen, onFocusId, onPressId],
  );

  // The channel the remote rests on, for the "on now" strip above the grid.
  const [restingId, setRestingId] = useState<string | undefined>(undefined);
  const restTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(restTimer.current), []);
  const onFocusItem = useCallback((item: BrowseItem) => {
    clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => setRestingId(item.id), GUIDE_AFTER_MS);
  }, []);
  const preview = items.find((item) => item.id === restingId) ?? items[0];
  const previewId = preview?.id;
  const [guides, setGuides] = useState<ReadonlyMap<string, { at: number; guide: Guide | null }>>(new Map());
  const guideOf = source.guide;
  useEffect(() => {
    if (guideOf === undefined || previewId === undefined) return;
    const known = guides.get(previewId);
    if (known !== undefined && Date.now() - known.at < GUIDE_FRESH_MS) return;
    let live = true;
    guideOf(previewId)
      .catch(() => null) // the strip works without it
      .then((guide) => {
        if (live) setGuides((previous) => new Map(previous).set(previewId, { at: Date.now(), guide }));
      });
    return () => {
      live = false;
    };
    // `guides` is left out on purpose: the answer arriving must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideOf, previewId]);

  const poster = source.layout === "poster";
  const columns = poster ? 7 : 3;
  const cells = useMemo<(BrowseItem | undefined)[]>(() => {
    // Pad the last row so its tiles keep the same width as the rest.
    const padding = (columns - (items.length % columns)) % columns;
    return [...items, ...Array.from({ length: padding }, () => undefined)];
  }, [items, columns]);

  if (entries.length === 0 || (first === undefined && source.categories.length === 0)) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{`No ${source.noun} yet`}</Text>
        <Muted>{empty}</Muted>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TVFocusGuideView autoFocus style={styles.menu}>
        <FlatList
          data={entries}
          keyExtractor={(entry) => entry.id}
          getItemLayout={(_data, index) => ({
            length: rowHeight,
            offset: rowHeight * index,
            index,
          })}
          initialNumToRender={14}
          maxToRenderPerBatch={8}
          windowSize={7}
          showsVerticalScrollIndicator={false}
          extraData={`${current?.id}|${genresOpen}`}
          renderItem={renderMenuItem}
        />
      </TVFocusGuideView>
      <TVFocusGuideView autoFocus style={styles.pane}>
        <View style={styles.paneHead}>
          <Text style={styles.paneTitle} numberOfLines={1}>
            {shownEntry?.label ?? ""}
          </Text>
          {shownEntry !== undefined ? <Text style={styles.paneCount}>{`${withCommas(shownEntry.count)} ${shownEntry.count === 1 ? source.single : source.noun}`}</Text> : null}
        </View>
        {guideOf !== undefined && preview !== undefined ? <OnNow item={preview} loaded={guides.has(preview.id)} guide={guides.get(preview.id)?.guide ?? null} /> : null}
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Muted>{`Nothing in here yet.`}</Muted>
          </View>
        ) : (
          <FlatList
            key={columns}
            data={cells}
            numColumns={columns}
            keyExtractor={(cell, index) => cell?.id ?? `pad${index}`}
            columnWrapperStyle={poster ? styles.posterColumns : styles.channelColumns}
            contentContainerStyle={styles.grid}
            initialNumToRender={columns * 2}
            maxToRenderPerBatch={columns}
            windowSize={5}
            showsVerticalScrollIndicator={false}
            onEndReachedThreshold={1.5}
            onEndReached={() => setLimit((value) => (value < MAX_ITEMS && items.length >= value ? value + PAGE : value))}
            renderItem={({ item: cell }) =>
              cell === undefined ? <View style={styles.pad} /> : poster ? <PosterTile item={cell} onSelect={(picked) => onSelect(picked, items)} /> : <ChannelTile item={cell} onSelect={(picked) => onSelect(picked, items)} onFocusItem={onFocusItem} />
            }
          />
        )}
      </TVFocusGuideView>
    </View>
  );
}

const PosterTile = memo(function PosterTile({ item, onSelect }: { item: BrowseItem; onSelect: (item: BrowseItem) => void }) {
  const poster: PosterItem = {
    id: item.id,
    name: item.title,
    posterUrl: item.imageUrl,
    progress: item.progress ?? null,
  };
  return <PosterCard grid item={poster} onPress={() => onSelect(item)} />;
});

/** The channel the remote rests on, with what is airing and what follows, above the grid. */
const OnNow = memo(function OnNow({ item, guide, loaded }: { item: BrowseItem; guide: Guide | null; loaded: boolean }) {
  const now = guide?.now ?? null;
  const next = guide?.next ?? null;
  const span = now !== null ? now.end - now.start : 0;
  const progress = now !== null && span > 0 ? Math.min(1, Math.max(0, (Date.now() - now.start) / span)) : 0;
  return (
    <View style={styles.onNow}>
      <View style={styles.onNowLogo}>
        {item.imageUrl !== null && item.imageUrl !== "" ? <Image source={{ uri: item.imageUrl }} style={styles.logoImage} resizeMode="contain" resizeMethod="resize" fadeDuration={0} /> : null}
      </View>
      <View style={styles.onNowText}>
        <Text style={styles.onNowChannel} numberOfLines={1}>
          {item.number !== undefined && item.number !== null ? `${item.number}  ${item.title}` : item.title}
        </Text>
        {now !== null ? (
          <>
            <Text style={styles.onNowTitle} numberOfLines={1}>
              {now.title}
            </Text>
            <View style={styles.onNowMeta}>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
              <Text style={styles.onNowTime} numberOfLines={1}>
                {`${clock(now.start)} to ${clock(now.end)}`}
                {next !== null ? `   Next ${clock(next.start)}  ${next.title}` : ""}
              </Text>
            </View>
          </>
        ) : next !== null ? (
          // The provider only listed what is coming up.
          <>
            <Text style={styles.onNowTitle} numberOfLines={1}>
              {next.title}
            </Text>
            <Text style={styles.onNowTime}>{`Starts ${clock(next.start)}`}</Text>
          </>
        ) : (
          <Text style={styles.onNowNone}>{loaded ? "No guide for this channel" : ""}</Text>
        )}
      </View>
    </View>
  );
});

const ChannelTile = memo(function ChannelTile({ item, onSelect, onFocusItem }: { item: BrowseItem; onSelect: (item: BrowseItem) => void; onFocusItem: (item: BrowseItem) => void }) {
  return (
    <Focusable onPress={() => onSelect(item)} onFocus={() => onFocusItem(item)} style={styles.channel} focusedStyle={styles.channelFocused}>
      <View style={styles.logo}>
        {item.imageUrl !== null && item.imageUrl !== "" ? <Image source={{ uri: item.imageUrl }} style={styles.logoImage} resizeMode="contain" resizeMethod="resize" fadeDuration={0} /> : null}
      </View>
      <Text style={styles.channelName} numberOfLines={1}>
        {item.title}
      </Text>
      {item.number !== undefined && item.number !== null ? <Text style={styles.channelNumber}>{item.number}</Text> : null}
    </Focusable>
  );
});

const styles = styleSheet({
  screen: { flex: 1, flexDirection: "row" },
  menu: { width: 380, flexGrow: 0, paddingRight: 20 },
  pane: { flex: 1, paddingLeft: 12 },
  paneHead: { flexDirection: "row", alignItems: "baseline", gap: 20, paddingTop: 12, paddingBottom: 24, paddingHorizontal: 8 },
  paneTitle: { flexShrink: 1, color: colors.foreground, fontSize: 38, fontWeight: "600", letterSpacing: -0.5 },
  paneCount: { color: colors.faint, fontSize: 24 },
  onNow: { flexDirection: "row", alignItems: "center", gap: 24, marginHorizontal: 8, marginBottom: 22, padding: 20, borderRadius: 20, backgroundColor: "#ffffff0d" },
  onNowLogo: { width: 132, height: 88, borderRadius: 12, backgroundColor: colors.sunken, overflow: "hidden" },
  onNowText: { flex: 1, gap: 4, height: 118, justifyContent: "center" },
  onNowChannel: { color: colors.accent, fontSize: 22, fontWeight: "600", letterSpacing: 0.5 },
  onNowTitle: { color: colors.foreground, fontSize: 32, fontWeight: "600", letterSpacing: -0.4 },
  onNowMeta: { flexDirection: "row", alignItems: "center", gap: 18 },
  bar: { width: 200, height: 6, borderRadius: 3, backgroundColor: "#ffffff26", overflow: "hidden" },
  barFill: { height: 6, backgroundColor: colors.accent },
  onNowTime: { flex: 1, color: colors.muted, fontSize: 22 },
  onNowNone: { color: colors.faint, fontSize: 26 },
  grid: { paddingBottom: 80 },
  posterColumns: { gap: 18 },
  channelColumns: { gap: 16 },
  pad: { flex: 1 },
  channelFocused: { backgroundColor: "#ffffff24", borderColor: "transparent", transform: [{ scale: 1.02 }] },
  channel: { flex: 1, flexDirection: "row", alignItems: "center", gap: 18, paddingVertical: 12, paddingHorizontal: 18, backgroundColor: colors.raised, borderRadius: 16, marginBottom: 14 },
  logo: { width: 84, height: 56, borderRadius: 10, backgroundColor: colors.sunken, overflow: "hidden" },
  logoImage: { width: "100%", height: "100%" },
  channelName: { flex: 1, color: colors.foreground, fontSize: 24, fontWeight: "500" },
  channelNumber: { color: colors.faint, fontSize: 22 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.m, padding: space.xl },
  emptyTitle: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
});
