import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, Text, TVFocusGuideView, useTVEventHandler, View, type CellRendererProps, type ViewProps } from "react-native";
import { Image } from "expo-image";
import { NavArrowRight } from "iconoir-react-native";
import { splitTitle } from "@testcard/core/src/normalise/splitTitle.js";
import { colors, styleSheet, uiScale } from "../theme";
import { Facts, type DetailAction } from "../ui/DetailActions";
import { OptionsSheet } from "../ui/OptionsSheet";
import { BackToTop } from "../ui/backToTop";
import { Fade } from "../ui/Fade";
import { focusedNow, lastFocused, useFocusTracking } from "../ui/Focusable";
import { ChannelShelf } from "../ui/ChannelCard";
import { PosterCard, PosterRow, type PosterItem } from "../ui/Poster";

/** A poster on the landing page, with what the hero shows when the remote rests on it. */
export interface HomeItem extends PosterItem {
  readonly rating: string | null;
  readonly plot: string | null;
  readonly durationSecs: number | null;
  readonly favourite: boolean;
  /** Started and worth resuming: the hero's button says Resume. */
  readonly resume: boolean;
  /** Present on a live channel (null when it has no number): the hero shows its logo instead of art. */
  readonly channelNumber?: number | null;
}

export interface HomeRow {
  readonly key: string;
  readonly label: string;
  readonly items: readonly HomeItem[];
  /** Draw big rank numbers beside the posters (a top 10). */
  readonly ranked?: boolean;
  /** Landscape logo cards instead of posters (Live TV). */
  readonly channels?: boolean;
  /** A category the viewer pinned to Home: the row says so. */
  readonly pinned?: boolean;
}

/** What can be done with a title: OK on its card does `onSelect`; holding OK lists these. */
export interface HeroActions {
  readonly primary: { label: string; onPress: () => void; progress?: number | undefined };
  readonly actions: readonly DetailAction[];
}

/** What the provider only tells us when asked about one title. */
export interface HomeDetail {
  readonly plot: string | null;
  readonly durationSecs: number | null;
}

/** "1h 36m" / "42m". */
function runtime(secs: number): string {
  const minutes = Math.round(secs / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** The band at the top of the rows that a row scrolls up under; the focused row is lined up just below it. */
const ROWS_BAND = 56;
/** The same band in layout units: styleSheet() scales style numbers by uiScale, but scroll offsets are not styles. */
const BAND_DP = Math.round(ROWS_BAND * uiScale);
/** How long the remote must rest on a poster before the hero changes, so flicking along a row does not redraw it every step. */
// Past the remote's key-repeat interval, so holding a direction along a row does not swap (and decode) the
// hero's art on every step.
const HERO_AFTER_MS = 240;
/** Longer, since this one costs a request to the provider. */
const DETAIL_AFTER_MS = 700;

/**
 * The Movies / Series landing page, laid out like a streaming service: full-bleed art behind the nav bar,
 * a hero that describes the highlighted title and lets you play it, and rows of posters under it. Rows are
 * plain reads of the local database, built by the caller; only the ones near the screen are drawn.
 */
export function HomeScreen({
  rows,
  onSelect,
  heroActions,
  fetchDetail,
  browseAll,
}: {
  rows: readonly HomeRow[];
  /** Movies, Series and Live TV: an "All categories" button above the rows opens the full category list. */
  browseAll?: (() => void) | undefined;
  onSelect: (item: PosterItem) => void;
  /** `rowKey` is the row the remote is on, since the same title can sit in more than one. */
  heroActions: (item: HomeItem, rowKey: string) => HeroActions;
  /** Looks up the plot and length the list did not carry (films only get them from the provider one at a time). */
  fetchDetail?: (id: string) => Promise<HomeDetail | null>;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, { item: HomeItem; row: string; rowKey: string }>();
    for (const row of rows) for (const item of row.items) if (!map.has(`${row.key}|${item.id}`)) map.set(`${row.key}|${item.id}`, { item, row: row.label, rowKey: row.key });
    return map;
  }, [rows]);
  const first = rows[0]?.items[0];
  // Unset until the remote rests on a poster: until then the hero follows the first row's first title, which
  // is Continue watching once the history has synced in. Seeding it here instead would freeze the hero on
  // whatever row happened to be first when Home mounted, before that history arrived.
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onFocusItem = useCallback((item: PosterItem, rowKey: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocusedId(`${rowKey}|${item.id}`), HERO_AFTER_MS);
  }, []);

  const [details, setDetails] = useState<ReadonlyMap<string, HomeDetail>>(new Map());
  const asked = useRef(new Set<string>());

  // Kept as the same object while the highlighted title is the same, so the hero's buttons are not rebuilt on every render.
  const shown = useMemo(
    () => (focusedId !== undefined ? byId.get(focusedId) : undefined) ?? (first !== undefined ? { item: first, row: rows[0]?.label ?? "", rowKey: rows[0]?.key ?? "" } : undefined),
    [byId, focusedId, first, rows],
  );

  // A highlighted title with no plot or length gets them fetched once the remote has rested on it for a moment.
  const shownId = shown?.item.id;
  const missing = shown !== undefined && (shown.item.plot === null || shown.item.plot === "" || shown.item.durationSecs === null);
  useEffect(() => {
    if (fetchDetail === undefined || shownId === undefined || !missing || asked.current.has(shownId)) return;
    const timer = setTimeout(() => {
      asked.current.add(shownId);
      fetchDetail(shownId)
        .then((detail) => {
          if (detail !== null) setDetails((previous) => new Map(previous).set(shownId, detail));
        })
        // The hero works without them. Asked again next time the remote rests here, since a failure (or a
        // lookup dropped because the remote moved on first) is not an answer.
        .catch(() => asked.current.delete(shownId));
    }, DETAIL_AFTER_MS);
    return () => clearTimeout(timer);
  }, [fetchDetail, shownId, missing]);

  // The row the remote is on is lined up just below the top band (styles.rowsFade), so it is never left half cut off
  // at the edge. Android does it, in the one scroll it makes to bring the focused poster into view: each row declares
  // where it should land (scrollSnapOffset) and the list snaps by item. Lining it up from JS as well, after focus
  // moved, raced that native scroll, so a row change left the list at one offset and slid it to another a moment later.
  const Cell = useMemo(
    () =>
      function Cell({ onLayout, onFocusCapture, style, children }: CellRendererProps<HomeRow>) {
        return (
          <View
            style={style}
            scrollSnapOffset={BAND_DP}
            // The list's focus event type and View's differ only in the TV fork's typings; they are the same event.
            onFocusCapture={onFocusCapture as ViewProps["onFocusCapture"]}
            onLayout={onLayout}
          >
            {children}
          </View>
        );
      },
    [],
  );

  // The hero only describes the highlighted title; it has no buttons of its own, so Up from the first row goes
  // straight to the nav bar and no row is ever a long way from what it offers. Holding OK on a card lists what can be
  // done with that title (play or resume, more info, My list...), from any row. The TV fork reports select only on
  // release, so Pressable's onLongPress never fires; the remote's own "longSelect" does, repeatedly while held, and
  // the press on release that follows is ignored.
  const held = useRef<{ item: HomeItem; rowKey: string; view: typeof focusedNow.current } | null>(null);
  const [options, setOptions] = useState<{ title: string; actions: HeroActions } | null>(null);
  const optionsOpen = useRef(false);
  optionsOpen.current = options !== null;
  const heldAt = useRef(0);
  const opener = useRef<typeof lastFocused.current>(null);
  useTVEventHandler((event) => {
    if (event.eventType !== "longSelect") return;
    heldAt.current = Date.now();
    const card = held.current;
    // Every landing page is mounted at once; only the one whose card has the remote's focus answers.
    if (optionsOpen.current || card === null || card.view === null || focusedNow.current !== card.view) return;
    opener.current = lastFocused.current;
    setOptions({ title: splitTitle(card.item.name).title, actions: heroActions(card.item, card.rowKey) });
  });
  const closeOptions = useCallback(() => {
    setOptions(null);
    setTimeout(() => opener.current?.requestTVFocus?.(), 0);
  }, []);
  const select = useCallback(
    (item: PosterItem) => {
      if (Date.now() - heldAt.current < 800) return;
      onSelect(item);
    },
    [onSelect],
  );

  // The band over the top of the rows is only wanted below the first row: at rest it would sit over the first row's
  // title. Keyed to the row the remote is on, not the scroll offset: the scroll back to the top does not reliably
  // report its final position, which left the band drawn over the first row's title after coming back up to it.
  const rowIndex = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows]);
  const rowIndexRef = useRef(rowIndex);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  rowIndexRef.current = rowIndex;
  const [scrolled, setScrolled] = useState(false);

  // Back to the nav bar (see BackToTop): the rows go back to the top and the hero to the first title. The rows are
  // redrawn (a new key) as well as scrolled, or the focus guide would still send Down to the poster the viewer left.
  const backToTop = useContext(BackToTop);
  const listRef = useRef<FlatList<HomeRow>>(null);
  const [listKey, setListKey] = useState(0);
  const moved = useRef(false);
  useEffect(() => {
    if (backToTop === 0 || !moved.current) return;
    moved.current = false;
    clearTimeout(timer.current);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    setScrolled(false);
    setFocusedId(undefined);
    setListKey((key) => key + 1);
  }, [backToTop]);

  // One focus handler per row, made once and reused: a fresh one on every render would defeat the rows' memo, so a
  // hero change (or anything else that re-renders this screen) would redraw every card on screen.
  const focusHandlers = useRef(new Map<string, (item: PosterItem) => void>());
  const focusFor = useCallback(
    (rowKey: string) => {
      let handler = focusHandlers.current.get(rowKey);
      if (handler === undefined) {
        handler = (item: PosterItem) => {
          const full = byIdRef.current.get(`${rowKey}|${item.id}`)?.item;
          if (full !== undefined) held.current = { item: full, rowKey, view: focusedNow.current };
          moved.current = true;
          setScrolled((rowIndexRef.current.get(rowKey) ?? 0) > 0);
          onFocusItem(item, rowKey);
        };
        focusHandlers.current.set(rowKey, handler);
      }
      return handler;
    },
    [onFocusItem],
  );

  const renderRow = useCallback(
    ({ item: row }: { item: HomeRow }) => {
      const focus = focusFor(row.key);
      return row.channels === true ? (
        <ChannelShelf title={row.label} items={row.items} onPress={select} onFocusItem={focus} pinned={row.pinned === true} />
      ) : row.ranked === true ? (
        <RankedRow title={row.label} items={row.items} onPress={select} onFocusItem={focus} />
      ) : (
        <PosterRow title={row.label} items={row.items} onPress={select} onFocusItem={focus} pinned={row.pinned === true} />
      );
    },
    [select, focusFor],
  );

  return (
    <View style={styles.screen}>
      <Hero
        shown={shown}
        plot={shown !== undefined ? (shown.item.plot !== null && shown.item.plot !== "" ? shown.item.plot : (details.get(shown.item.id)?.plot ?? null)) : null}
        durationSecs={shown !== undefined ? (shown.item.durationSecs ?? details.get(shown.item.id)?.durationSecs ?? null) : null}
      />
      <TVFocusGuideView key={listKey} autoFocus style={styles.rows}>
        {/* Solid, with only its lower edge fading: the strip above the focused row holds the bottom of the row
            before it, and a see-through scrim left that row's titles floating there with no posters. */}
        {scrolled ? (
          <View style={styles.rowsFade} pointerEvents="none">
            <View style={styles.rowsFadeSolid} />
            <View style={styles.rowsFadeEdge}>
              <Fade from="top" />
            </View>
          </View>
        ) : null}
        <FlatList
          ref={listRef}
          data={rows}
          ListHeaderComponent={browseAll !== undefined ? <BrowseAllButton onPress={browseAll} /> : null}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          CellRendererComponent={Cell}
          // Enough rows drawn ahead that the remote always has a next row to land on; with fewer, the first Down press finds nothing yet.
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={9}
          removeClippedSubviews={false}
          snapToAlignment="item"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
        />
        {/* The next row's title peeks in at the bottom edge; faded out rather than sliced through. */}
        <View style={styles.rowsBottomFade} pointerEvents="none">
          <Fade from="bottom" />
        </View>
      </TVFocusGuideView>
      <Modal transparent animationType="fade" visible={options !== null} onRequestClose={closeOptions}>
        {options !== null ? (
          <OptionsSheet
            title={options.title}
            options={[{ id: "primary", label: options.actions.primary.label }, ...options.actions.actions.map((action) => ({ id: action.key, label: action.label }))]}
            onChoose={(id) => (id === "primary" ? options.actions.primary.onPress() : options.actions.actions.find((action) => action.key === id)?.onPress())}
            onClose={closeOptions}
          />
        ) : null}
      </Modal>
    </View>
  );
}

/** The way into every category, above the rows: a quiet pill until the remote is on it. */
const BrowseAllButton = memo(function BrowseAllButton({ onPress }: { onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  const tracking = useFocusTracking();
  const ink = focused ? colors.background : colors.muted;
  return (
    <View style={styles.browseAllRow}>
      <Pressable
        ref={tracking.ref}
        focusable
        onPress={onPress}
        onFocus={() => {
          tracking.focused();
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          tracking.blurred();
        }}
        style={[styles.browseAll, focused && styles.browseAllFocused]}
      >
        <Text style={[styles.browseAllLabel, { color: ink }]}>All categories</Text>
        <NavArrowRight color={ink} width={Math.round(26 * uiScale)} height={Math.round(26 * uiScale)} strokeWidth={2} />
      </Pressable>
    </View>
  );
});

function Hero({ shown, plot, durationSecs }: { shown: { item: HomeItem; row: string } | undefined; plot: string | null; durationSecs: number | null }) {
  // A title that wraps to a second line takes the plot's second line, so the buttons always stay inside the hero
  // instead of running off its foot under the rows.
  const [titleLines, setTitleLines] = useState(1);
  const wrapped = titleLines > 1;
  const channel = shown?.item.channelNumber !== undefined;
  const parts = shown !== undefined ? (channel ? { title: shown.item.name, year: null, is4k: false } : splitTitle(shown.item.name)) : undefined;
  const rating = shown?.item.rating !== null && shown?.item.rating !== undefined && Number(shown.item.rating) > 0 && Number(shown.item.rating) <= 10 ? Number(shown.item.rating).toFixed(1) : null;
  const facts = channel
    ? ["Live", shown?.item.channelNumber !== null && shown?.item.channelNumber !== undefined ? `Channel ${shown.item.channelNumber}` : null].filter((fact): fact is string => fact !== null)
    : [parts?.year ?? null, durationSecs !== null && durationSecs >= 60 ? runtime(durationSecs) : null, rating !== null ? `${rating} rating` : null, parts?.is4k === true ? "4K" : null].filter((fact): fact is string => fact !== null);
  const art = shown?.item.posterUrl ?? null;
  return (
    <View style={styles.hero}>
      {channel ? (
        <View style={styles.logoPanel} pointerEvents="none">
          {art !== null && art !== "" ? <Image source={{ uri: art }} style={styles.logoImage} contentFit="contain" cachePolicy="memory-disk" /> : null}
        </View>
      ) : art !== null && art !== "" ? (
        <View style={styles.art} pointerEvents="none">
          <Image source={{ uri: art }} style={styles.artImage} contentFit="cover" cachePolicy="memory-disk" transition={300} />
          <Fade from="left" />
          {/* The picture dissolves into the page at its own foot: cut off square above the hero's fade, it left a
              hard line and a dark strip before the rows. */}
          <View style={styles.artFoot}>
            <Fade from="bottom" />
          </View>
        </View>
      ) : null}
      <View style={styles.topFade} pointerEvents="none">
        <Fade from="top" strength={0.85} />
      </View>
      <View style={styles.bottomFade} pointerEvents="none">
        <Fade from="bottom" />
      </View>
      <View style={styles.heroText}>
        <Text style={styles.kicker} numberOfLines={1}>
          {shown?.row ?? ""}
        </Text>
        <Text style={styles.title} numberOfLines={2} onTextLayout={(event) => setTitleLines(event.nativeEvent.lines.length)}>
          {parts?.title ?? ""}
        </Text>
        <View style={styles.factsSlot}>
          <Facts facts={facts} />
        </View>
        <Text style={[styles.plot, wrapped && styles.plotShort]} numberOfLines={wrapped ? 1 : 2}>
          {plot ?? ""}
        </Text>
        {shown !== undefined ? (
          <View style={styles.holdHint}>
            <View style={styles.keyCap}>
              <Text style={styles.keyCapText}>OK</Text>
            </View>
            <Text style={styles.holdHintText}>Hold for more options</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** A "top 10": each poster with its rank in big numerals behind its left edge. */
const RankedRow = memo(function RankedRow({
  title,
  items,
  onPress,
  onFocusItem,
}: {
  title: string;
  items: readonly HomeItem[];
  onPress: (item: PosterItem) => void;
  onFocusItem: (item: PosterItem) => void;
}) {
  return (
    <View style={styles.ranked}>
      <Text style={styles.rankedTitle}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <View style={styles.rankedItem}>
            <Text style={styles.rank}>{index + 1}</Text>
            <PosterCard item={item} onPress={onPress} onFocusItem={onFocusItem} />
          </View>
        )}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={6}
        windowSize={5}
        contentContainerStyle={styles.rankedList}
      />
    </View>
  );
});

const styles = styleSheet({
  screen: { flex: 1, backgroundColor: colors.background },
  hero: { height: 570, backgroundColor: colors.background, overflow: "hidden" },
  art: { position: "absolute", top: 0, right: 0, width: 1180, height: 570, overflow: "hidden" },
  artFoot: { position: "absolute", left: 0, right: 0, bottom: 0, height: 280 },
  artImage: { position: "absolute", left: 0, top: -270, width: 1180, height: 1770 },
  logoPanel: { position: "absolute", top: 130, right: 120, width: 440, height: 280, padding: 28, borderRadius: 24, backgroundColor: colors.raised },
  logoImage: { width: "100%", height: "100%" },
  topFade: { position: "absolute", left: 0, right: 0, top: 0, height: 220 },
  bottomFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 200 },
  heroText: { position: "absolute", left: 52, top: 118, width: 1000, gap: 12 },
  factsSlot: { height: 44 },
  kicker: { color: colors.accent, fontSize: 24, fontWeight: "600", letterSpacing: 1 },
  title: { color: colors.foreground, fontSize: 68, lineHeight: 78, fontWeight: "600", letterSpacing: -1.5 },
  plot: { height: 72, color: "#c3c9ce", fontSize: 25, lineHeight: 36, marginTop: 2 },
  plotShort: { height: 36 },
  holdHint: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
  keyCap: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 8, borderWidth: 2, borderColor: "#ffffff40" },
  keyCapText: { color: colors.muted, fontSize: 18, fontWeight: "600" },
  holdHintText: { color: colors.faint, fontSize: 22 },
  rows: { flex: 1, paddingHorizontal: 44 },
  rowsFade: { position: "absolute", left: 0, right: 0, top: 0, height: ROWS_BAND, zIndex: 1 },
  rowsFadeSolid: { height: ROWS_BAND - 16, backgroundColor: colors.background },
  rowsFadeEdge: { height: 16 },
  rowsBottomFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 72, zIndex: 1 },
  list: { paddingTop: 20, paddingBottom: 100 },
  browseAllRow: { flexDirection: "row", paddingBottom: 12 },
  browseAll: { height: 52, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 24, paddingRight: 16, borderRadius: 26, borderWidth: 2, borderColor: colors.border },
  browseAllFocused: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  browseAllLabel: { fontSize: 22, fontWeight: "500" },
  ranked: { gap: 16, marginBottom: 24 },
  rankedTitle: { color: colors.foreground, fontSize: 32, fontWeight: "600", letterSpacing: -0.3, paddingLeft: 8 },
  rankedList: { gap: 4, paddingVertical: 8, paddingHorizontal: 8 },
  rankedItem: { flexDirection: "row", alignItems: "flex-start" },
  rank: { width: 118, marginRight: -34, color: "#2a3138", fontSize: 250, lineHeight: 250, fontWeight: "700", letterSpacing: -20, textAlign: "right", marginTop: 74 },
});
