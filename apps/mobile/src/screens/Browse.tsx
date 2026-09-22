import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Text, TVFocusGuideView, View } from "react-native";
import { genreOptions } from "@testcard/core/src/normalise/genres.js";
import { colors, space, type, styleSheet, uiScale } from "../theme";
import { Muted } from "../ui/controls";
import { Focusable } from "../ui/Focusable";
import { MenuRow, ROW_HEIGHT, withCommas } from "../ui/MenuRow";
import { Pill } from "../ui/Pill";
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
  /** Whether the list offers the Genres group. On by default; Live TV turns it off. */
  readonly genres?: boolean;
  /** Where the categories sit: a list down the left (default) or a row of pills across the top. */
  readonly menu?: "list" | "pills";
  /** Pinning a category to the Home page. Left out where it does not apply. */
  readonly pinning?: {
    readonly isPinned: (categoryId: string) => boolean;
    readonly toggle: (categoryId: string, label: string) => void;
  };
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
    if (source.genres !== false && genres.length > 0) {
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
  // A real category (not Continue watching, My list or a genre) can be pinned to Home.
  const [, setPinTick] = useState(0);
  const [pinNote, setPinNote] = useState<string>();
  useEffect(() => {
    if (pinNote === undefined) return;
    const timer = setTimeout(() => setPinNote(undefined), 3000);
    return () => clearTimeout(timer);
  }, [pinNote]);
  const pinnable = source.pinning !== undefined && shownEntry?.kind === "row" && shownEntry.selection.kind === "category" ? { id: shownEntry.selection.key, label: shownEntry.label } : undefined;
  const pinned = pinnable !== undefined && source.pinning !== undefined && source.pinning.isPinned(pinnable.id);

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
  const pills = source.menu === "pills";
  const columns = poster ? 7 : pills ? 4 : 3;
  const pillEntries = useMemo(() => entries.filter((entry) => entry.kind === "row"), [entries]);
  const renderPill = useCallback(
    ({ item: entry }: { item: Entry }) => (entry.kind === "row" ? <Pill id={entry.id} label={entry.label} active={entry.id === activeId} onPressId={onPressId} onFocusId={onFocusId} /> : null),
    [activeId, onFocusId, onPressId],
  );
  // The row the remote is on is brought to a steady place in the frame, so it is never left half cut off at an edge.
  const gridRef = useRef<FlatList<BrowseItem | undefined>>(null);
  const gridRow = useRef(-1);
  const alignGridRow = useCallback(
    (item: BrowseItem) => {
      const index = items.findIndex((entry) => entry.id === item.id);
      if (index < 0) return;
      const row = Math.floor(index / columns);
      if (gridRow.current === row) return;
      gridRow.current = row;
      gridRef.current?.scrollToIndex({ index: row, viewPosition: 0.3, animated: true });
    },
    [columns, items],
  );
  useEffect(() => {
    gridRow.current = -1;
  }, [shown?.id]);
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

  const pane = (
        <TVFocusGuideView autoFocus style={pills ? styles.paneWide : styles.pane}>
          <View style={styles.paneHead}>
            <Text style={styles.paneTitle} numberOfLines={1}>
              {shownEntry?.label ?? ""}
            </Text>
            {shownEntry !== undefined ? <Text style={styles.paneCount}>{`${withCommas(shownEntry.count)} ${shownEntry.count === 1 ? source.single : source.noun}`}</Text> : null}
          </View>
          {/* On its own line, above the first column, so pressing up from the first poster lands on it. */}
          {pinnable !== undefined ? (
            <View style={styles.pinRow}>
              <Focusable
                style={styles.pin}
                onPress={() => {
                  source.pinning?.toggle(pinnable.id, pinnable.label);
                  setPinNote(pinned ? "Removed from your Home page" : "Added to your Home page");
                  setPinTick((value) => value + 1);
                }}
              >
                {({ focused }) => <Text style={[styles.pinText, pinned && styles.pinTextOn, focused && styles.pinTextFocused]}>{pinned ? "Pinned to Home. Press to remove" : "Pin to Home"}</Text>}
              </Focusable>
              {pinNote !== undefined ? <Text style={styles.pinNote}>{pinNote}</Text> : null}
            </View>
          ) : null}
          {guideOf !== undefined && preview !== undefined ? <OnNow hero={pills} item={preview} loaded={guides.has(preview.id)} guide={guides.get(preview.id)?.guide ?? null} /> : null}
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Muted>{`Nothing in here yet.`}</Muted>
            </View>
          ) : (
            <FlatList
              ref={gridRef}
              onScrollToIndexFailed={(info) => gridRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })}
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
                cell === undefined ? <View style={styles.pad} /> : poster ? <PosterTile item={cell} onSelect={(picked) => onSelect(picked, items)} onFocusTile={alignGridRow} /> : <ChannelTile card={pills} item={cell} onSelect={(picked) => onSelect(picked, items)} onFocusItem={(picked) => { alignGridRow(picked); onFocusItem(picked); }} />
              }
            />
          )}
        </TVFocusGuideView>
  );

  if (pills)
    return (
      <View style={styles.column}>
        <TVFocusGuideView autoFocus style={styles.pills}>
          <FlatList horizontal data={pillEntries} keyExtractor={(entry) => entry.id} renderItem={renderPill} extraData={activeId} showsHorizontalScrollIndicator={false} initialNumToRender={10} windowSize={5} contentContainerStyle={styles.pillList} />
        </TVFocusGuideView>
        {pane}
      </View>
    );

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
      {pane}
    </View>
  );
}

const PosterTile = memo(function PosterTile({ item, onSelect, onFocusTile }: { item: BrowseItem; onSelect: (item: BrowseItem) => void; onFocusTile: (item: BrowseItem) => void }) {
  const poster: PosterItem = {
    id: item.id,
    name: item.title,
    posterUrl: item.imageUrl,
    progress: item.progress ?? null,
  };
  return <PosterCard grid item={poster} onPress={() => onSelect(item)} onFocusItem={() => onFocusTile(item)} />;
});

/** The channel the remote rests on, with what is airing and what follows, above the grid. */
const OnNow = memo(function OnNow({ item, guide, loaded, hero = false }: { item: BrowseItem; guide: Guide | null; loaded: boolean; hero?: boolean }) {
  const now = guide?.now ?? null;
  const next = guide?.next ?? null;
  const span = now !== null ? now.end - now.start : 0;
  const progress = now !== null && span > 0 ? Math.min(1, Math.max(0, (Date.now() - now.start) / span)) : 0;
  return (
    <View style={[styles.onNow, hero && styles.onNowHero]}>
      <View style={[styles.onNowLogo, hero && styles.onNowLogoHero]}>
        {item.imageUrl !== null && item.imageUrl !== "" ? <Image source={{ uri: item.imageUrl }} style={styles.logoImage} resizeMode="contain" resizeMethod="resize" fadeDuration={0} /> : null}
      </View>
      <View style={styles.onNowText}>
        <Text style={styles.onNowChannel} numberOfLines={1}>
          {item.number !== undefined && item.number !== null ? `${item.number}  ${item.title}` : item.title}
        </Text>
        {now !== null ? (
          <>
            <Text style={[styles.onNowTitle, hero && styles.onNowTitleHero]} numberOfLines={1}>
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

const ChannelTile = memo(function ChannelTile({ item, onSelect, onFocusItem, card = false }: { item: BrowseItem; onSelect: (item: BrowseItem) => void; onFocusItem: (item: BrowseItem) => void; card?: boolean }) {
  return (
    <Focusable onPress={() => onSelect(item)} onFocus={() => onFocusItem(item)} style={card ? styles.channelCard : styles.channel} focusedStyle={styles.channelFocused}>
      <View style={card ? styles.logoCard : styles.logo}>
        {item.imageUrl !== null && item.imageUrl !== "" ? <Image source={{ uri: item.imageUrl }} style={styles.logoImage} resizeMode="contain" resizeMethod="resize" fadeDuration={0} /> : null}
      </View>
      {card ? (
        <View style={styles.cardLine}>
          <Text style={styles.channelName} numberOfLines={1}>
            {item.title}
          </Text>
          {item.number !== undefined && item.number !== null ? <Text style={styles.channelNumber}>{item.number}</Text> : null}
        </View>
      ) : (
        <>
          <Text style={styles.channelName} numberOfLines={1}>
            {item.title}
          </Text>
          {item.number !== undefined && item.number !== null ? <Text style={styles.channelNumber}>{item.number}</Text> : null}
        </>
      )}
    </Focusable>
  );
});

const styles = styleSheet({
  screen: { flex: 1, flexDirection: "row" },
  menu: { width: 380, flexGrow: 0, paddingRight: 20 },
  pane: { flex: 1, paddingLeft: 12 },
  paneWide: { flex: 1 },
  column: { flex: 1 },
  pills: { flexGrow: 0, paddingBottom: 8 },
  pillList: { gap: 12, paddingHorizontal: 8, paddingVertical: 4 },
  paneHead: { flexDirection: "row", alignItems: "baseline", gap: 20, paddingTop: 12, paddingBottom: 24, paddingHorizontal: 8 },
  paneTitle: { flexShrink: 1, color: colors.foreground, fontSize: 38, fontWeight: "600", letterSpacing: -0.5 },
  paneCount: { color: colors.faint, fontSize: 24 },
  pinRow: { flexDirection: "row", paddingHorizontal: 8, paddingBottom: 16, marginTop: -10 },
  pin: { paddingHorizontal: 22, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card },
  pinNote: { color: colors.accent, fontSize: 24, marginLeft: 20, alignSelf: "center" },
  pinTextOn: { color: colors.accent },
  pinText: { color: colors.muted, fontSize: 24 },
  pinTextFocused: { color: colors.foreground },
  onNow: { flexDirection: "row", alignItems: "center", gap: 24, marginHorizontal: 8, marginBottom: 22, padding: 20, borderRadius: 20, backgroundColor: "#ffffff0d" },
  onNowHero: { gap: 32, padding: 28, marginBottom: 26 },
  onNowLogoHero: { width: 200, height: 132 },
  onNowTitleHero: { fontSize: 46, letterSpacing: -0.8 },
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
  channelCard: { flex: 1, gap: 12, padding: 14, backgroundColor: colors.raised, borderRadius: 16, marginBottom: 14 },
  logoCard: { height: 110, borderRadius: 10, backgroundColor: colors.sunken, overflow: "hidden" },
  cardLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 84, height: 56, borderRadius: 10, backgroundColor: colors.sunken, overflow: "hidden" },
  logoImage: { width: "100%", height: "100%" },
  channelName: { flex: 1, color: colors.foreground, fontSize: 24, fontWeight: "500" },
  channelNumber: { color: colors.faint, fontSize: 22 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.m, padding: space.xl },
  emptyTitle: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
});
