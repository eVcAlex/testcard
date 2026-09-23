import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Text, TVFocusGuideView, View } from "react-native";
import { Image } from "expo-image";
import { splitTitle } from "@testcard/core/src/normalise/splitTitle.js";
import { colors, styleSheet } from "../theme";
import { DetailActions, Facts, type DetailAction } from "../ui/DetailActions";
import { Fade } from "../ui/Fade";
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

/** What the hero's buttons do for the highlighted title. */
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

/** How long the remote must rest on a poster before the hero changes, so flicking along a row does not redraw it every step. */
const HERO_AFTER_MS = 140;
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
}: {
  rows: readonly HomeRow[];
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
  const [focusedId, setFocusedId] = useState<string | undefined>(first !== undefined && rows[0] !== undefined ? `${rows[0].key}|${first.id}` : undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onFocusItem = useCallback((item: PosterItem, rowKey: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocusedId(`${rowKey}|${item.id}`), HERO_AFTER_MS);
  }, []);

  const [details, setDetails] = useState<ReadonlyMap<string, HomeDetail>>(new Map());
  const asked = useRef(new Set<string>());

  const shown = (focusedId !== undefined ? byId.get(focusedId) : undefined) ?? (first !== undefined ? { item: first, row: rows[0]?.label ?? "", rowKey: rows[0]?.key ?? "" } : undefined);

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
        .catch(() => undefined); // the hero works without them
    }, DETAIL_AFTER_MS);
    return () => clearTimeout(timer);
  }, [fetchDetail, shownId, missing]);

  // The row the remote is on is lined up under the hero, so it is never left half cut off at the edge.
  const listRef = useRef<FlatList<HomeRow>>(null);
  const alignedRow = useRef(-1);
  const alignRow = useCallback((index: number) => {
    // Moving along a row must not ask the list to scroll again: only a change of row does.
    if (alignedRow.current === index) return;
    alignedRow.current = index;
    listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
  }, []);

  const renderRow = useCallback(
    ({ item: row, index }: { item: HomeRow; index: number }) => {
      const focus = (item: PosterItem) => {
        alignRow(index);
        onFocusItem(item, row.key);
      };
      return row.channels === true ? (
        <ChannelShelf title={row.label} items={row.items} onPress={onSelect} onFocusItem={focus} pinned={row.pinned === true} />
      ) : row.ranked === true ? (
        <RankedRow title={row.label} items={row.items} onPress={onSelect} onFocusItem={focus} />
      ) : (
        <PosterRow title={row.label} items={row.items} onPress={onSelect} onFocusItem={focus} pinned={row.pinned === true} />
      );
    },
    [onSelect, onFocusItem, alignRow],
  );

  return (
    <View style={styles.screen}>
      <Hero
        shown={shown}
        plot={shown !== undefined ? (shown.item.plot !== null && shown.item.plot !== "" ? shown.item.plot : (details.get(shown.item.id)?.plot ?? null)) : null}
        durationSecs={shown !== undefined ? (shown.item.durationSecs ?? details.get(shown.item.id)?.durationSecs ?? null) : null}
        actions={shown !== undefined ? heroActions(shown.item, shown.rowKey) : undefined}
      />
      <TVFocusGuideView autoFocus style={styles.rows}>
        <View style={styles.rowsFade} pointerEvents="none">
          <Fade from="top" />
        </View>
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          onScrollToIndexFailed={(info) => listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })}
          // Enough rows drawn ahead that the remote always has a next row to land on; with fewer, the first Down press finds nothing yet.
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={9}
          removeClippedSubviews={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
        />
      </TVFocusGuideView>
    </View>
  );
}

function Hero({ shown, plot, durationSecs, actions }: { shown: { item: HomeItem; row: string } | undefined; plot: string | null; durationSecs: number | null; actions: HeroActions | undefined }) {
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
        <Text style={styles.title} numberOfLines={2}>
          {parts?.title ?? ""}
        </Text>
        <View style={styles.factsSlot}>
          <Facts facts={facts} />
        </View>
        <Text style={styles.plot} numberOfLines={2}>
          {plot ?? ""}
        </Text>
        {/* Coming down from the nav bar lands on the main button, not on whichever button is nearest sideways. */}
        {actions !== undefined ? (
          <TVFocusGuideView autoFocus>
            <DetailActions preferred={false} hintBeside primary={actions.primary} actions={actions.actions} />
          </TVFocusGuideView>
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
  hero: { height: 600, backgroundColor: colors.background, overflow: "hidden" },
  art: { position: "absolute", top: 0, right: 0, width: 1180, height: 520, overflow: "hidden" },
  artImage: { position: "absolute", left: 0, top: -270, width: 1180, height: 1770 },
  logoPanel: { position: "absolute", top: 130, right: 120, width: 440, height: 280, padding: 28, borderRadius: 24, backgroundColor: colors.raised },
  logoImage: { width: "100%", height: "100%" },
  topFade: { position: "absolute", left: 0, right: 0, top: 0, height: 220 },
  bottomFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 200 },
  heroText: { position: "absolute", left: 52, top: 118, width: 1000, gap: 12 },
  factsSlot: { height: 44 },
  kicker: { color: colors.accent, fontSize: 24, fontWeight: "600", letterSpacing: 1 },
  title: { color: colors.foreground, fontSize: 68, fontWeight: "600", letterSpacing: -1.5 },
  plot: { height: 72, color: "#c3c9ce", fontSize: 25, lineHeight: 36, marginTop: 2 },
  rows: { flex: 1, paddingHorizontal: 44 },
  rowsFade: { position: "absolute", left: 0, right: 0, top: 0, height: 44, zIndex: 1 },
  list: { paddingTop: 30, paddingBottom: 100 },
  ranked: { gap: 16, marginBottom: 24 },
  rankedTitle: { color: colors.foreground, fontSize: 32, fontWeight: "600", letterSpacing: -0.3, paddingLeft: 8 },
  rankedList: { gap: 4, paddingVertical: 8, paddingHorizontal: 8 },
  rankedItem: { flexDirection: "row", alignItems: "flex-start" },
  rank: { width: 118, marginRight: -34, color: "#2a3138", fontSize: 250, lineHeight: 250, fontWeight: "700", letterSpacing: -20, textAlign: "right", marginTop: 74 },
});
