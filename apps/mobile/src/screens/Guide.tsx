import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Text, TVFocusGuideView, useTVEventHandler, View, type LayoutChangeEvent } from "react-native";
import { browseChannels, listFavouriteChannels, listRecentChannels, type ChannelRow } from "@testcard/core/src/db/queries.js";
import { fetchListings, knownListings, type Airing } from "../playback/airing";
import { useApp } from "../state/app";
import { colors, styleSheet, uiScale } from "../theme";
import { ChannelLogo } from "../ui/ChannelLogo";
import { Focusable } from "../ui/Focusable";
import { Pill, PILL_HEIGHT } from "../ui/Pill";
import { channelCategories } from "./Live";

/** How much of the day is on screen at once, and how far Left and Right move it at an edge. */
const WINDOW_MIN = 120;
const STEP_MIN = 60;
/** How far ahead the guide goes: past this, providers rarely list anything. */
const FURTHEST_MIN = 24 * 60;
const SLOT_MIN = 30;
const CHANNEL_W = 300;
const ROW_H = 96;
const ALL_CHANNELS_MOST = 2000;
/** A press of Right that moved focus onto the last cell is released inside this; only a press on it pages on. */
const MOVED_BY_THIS_PRESS_MS = 350;

const MINUTE = 60_000;
const floorToSlot = (ms: number) => Math.floor(ms / (SLOT_MIN * MINUTE)) * SLOT_MIN * MINUTE;
const two = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number) => {
  const at = new Date(ms);
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
};

/** One stretch of a row: a programme, or time the listings do not cover. */
interface Segment {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly airing: Airing | null;
  /** Why there is no programme: still being asked for, or nothing listed. */
  readonly empty?: "loading" | "none";
}

/** What the remote is on, for the details above the grid and for paging at the edges. */
interface Focused {
  readonly channel: ChannelRow;
  readonly segment: Segment;
  readonly first: boolean;
  readonly last: boolean;
  readonly at: number;
}

/**
 * A row's programmes cut to the window, with the gaps between them filled so every part of the row can be reached.
 * Keyed by where each block starts on screen, so the block the remote is on while a row loads is the same view as
 * the one that replaces it and keeps focus.
 */
function segmentsFor(airings: readonly Airing[] | null, from: number, to: number): Segment[] {
  if (airings === null) return [{ key: String(from), start: from, end: to, airing: null, empty: "loading" }];
  const out: Segment[] = [];
  let cursor = from;
  for (const airing of airings) {
    if (airing.end <= cursor || airing.start >= to) continue;
    if (airing.start > cursor) out.push({ key: String(cursor), start: cursor, end: airing.start, airing: null, empty: "none" });
    const start = Math.max(airing.start, cursor);
    const end = Math.min(airing.end, to);
    out.push({ key: String(start), start, end, airing });
    cursor = end;
  }
  if (cursor < to) out.push({ key: String(cursor), start: cursor, end: to, airing: null, empty: "none" });
  return out;
}

/**
 * The TV guide: channels down the side, time across the top, what is on and what is coming as blocks the remote moves
 * over. OK on any block watches that channel. Listings come from the imported guide when there is one, else from
 * the provider a few channels at a time as they come on screen. Left and Right at the grid's edges move it an hour.
 */
export function GuideScreen({
  sourceId,
  active,
  onPlay,
}: {
  sourceId: string | null;
  active: boolean;
  onPlay: (channel: { id: string; title: string }, channels: readonly { id: string; title: string }[]) => void;
}) {
  const { db, version, catalogue } = useApp();
  const own = useCallback((channel: ChannelRow) => sourceId === null || channel.source_id === sourceId, [sourceId]);

  // The lists to pick from: your own first, then every category.
  const lists = useMemo(() => {
    const favourites = listFavouriteChannels(db).filter(own);
    const recents = listRecentChannels(db, 60).filter(own);
    const categories = channelCategories(db, catalogue, sourceId ?? undefined).filter((category) => category.count > 0);
    return [
      ...(favourites.length > 0 ? [{ id: "favourites", label: "Favourites" }] : []),
      ...(recents.length > 0 ? [{ id: "recent", label: "Recently watched" }] : []),
      ...categories.map((category) => ({ id: category.id, label: category.label })),
      { id: "all", label: "All channels" },
    ];
  }, [db, version, catalogue, sourceId, own]);
  const [listId, setListId] = useState<string | null>(null);
  const shownList = listId !== null && lists.some((list) => list.id === listId) ? listId : (lists[0]?.id ?? "all");
  const channels = useMemo(() => {
    const scope = sourceId !== null ? { sourceId } : {};
    if (shownList === "favourites") return listFavouriteChannels(db).filter(own);
    if (shownList === "recent") return listRecentChannels(db, 60).filter(own);
    if (shownList === "all") return browseChannels(db, { limit: ALL_CHANNELS_MOST, ...scope });
    return browseChannels(db, { categoryId: shownList, limit: ALL_CHANNELS_MOST, ...scope });
  }, [db, version, shownList, sourceId, own]);

  // The clock moves the now line and, once the window's first slot is over, the window itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  const earliest = floorToSlot(now);
  const [offsetMin, setOffsetMin] = useState(0);
  const from = earliest + offsetMin * MINUTE;
  const to = from + WINDOW_MIN * MINUTE;

  const [gridPx, setGridPx] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => setGridPx(event.nativeEvent.layout.width - CHANNEL_W * uiScale), []);
  const pxPerMs = gridPx > 0 ? gridPx / (WINDOW_MIN * MINUTE) : 0;

  const [focused, setFocused] = useState<Focused | null>(null);
  const focusedRef = useRef<{ focused: Focused; since: number } | null>(null);
  // Where focus should land after the grid moves or a list opens: the block covering `at` on that channel's row.
  const [wantFocus, setWantFocus] = useState<{ channelId: string; at: number } | null>(null);
  // Only when a list opens: a sync that re-reads the same list leaves the remote where it was.
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  useEffect(() => {
    const first = channelsRef.current[0];
    setWantFocus(first !== undefined ? { channelId: first.id, at: Date.now() } : null);
    setOffsetMin(0);
  }, [shownList]);

  // `again` is the block already under the remote reporting that its programme changed (its row finished loading).
  const onFocusCell = useCallback((next: Focused, again: boolean) => {
    focusedRef.current = { focused: next, since: again && focusedRef.current !== null ? focusedRef.current.since : Date.now() };
    setFocused(next);
    setWantFocus(null);
  }, []);
  // Focus left the grid (up to the list pills): Left and Right there are the pills' own.
  const onLeaveCell = useCallback((channelId: string, key: string) => {
    const current = focusedRef.current?.focused;
    if (current !== undefined && current.channel.id === channelId && current.segment.key === key) focusedRef.current = null;
  }, []);

  useTVEventHandler((event) => {
    if (!active || event.eventKeyAction === 0) return;
    const current = focusedRef.current;
    if (current === null || Date.now() - current.since < MOVED_BY_THIS_PRESS_MS) return;
    const { focused: cell } = current;
    if (event.eventType === "right" && cell.last && offsetMin + WINDOW_MIN < FURTHEST_MIN) {
      setOffsetMin(offsetMin + STEP_MIN);
      setWantFocus({ channelId: cell.channel.id, at: to });
    } else if (event.eventType === "left" && cell.first && offsetMin > 0) {
      setOffsetMin(Math.max(0, offsetMin - STEP_MIN));
      setWantFocus({ channelId: cell.channel.id, at: from - 1 });
    }
  });

  const play = useCallback(
    (channel: ChannelRow) => {
      const stepping = channels.slice(0, 300).map((entry) => ({ id: entry.id, title: entry.normalised_name }));
      onPlay({ id: channel.id, title: channel.normalised_name }, stepping);
    },
    [channels, onPlay],
  );

  const renderRow = useCallback(
    ({ item }: { item: ChannelRow }) => (
      <GuideRow
        channel={item}
        from={from}
        to={to}
        pxPerMs={pxPerMs}
        now={now}
        preferredAt={wantFocus !== null && wantFocus.channelId === item.id ? wantFocus.at : null}
        onFocusCell={onFocusCell}
        onLeaveCell={onLeaveCell}
        onPlay={play}
      />
    ),
    [from, to, pxPerMs, now, wantFocus, onFocusCell, onLeaveCell, play],
  );

  const slots = useMemo(() => Array.from({ length: WINDOW_MIN / SLOT_MIN }, (_, index) => from + index * SLOT_MIN * MINUTE), [from]);
  const nowX = now >= from && now < to ? CHANNEL_W * uiScale + (now - from) * pxPerMs : null;

  return (
    <View style={styles.page}>
      <Details focused={focused} now={now} />
      <FlatList
        horizontal
        data={lists}
        keyExtractor={(list) => list.id}
        renderItem={({ item }) => <Pill id={item.id} label={item.label} active={item.id === shownList} onPressId={setListId} />}
        showsHorizontalScrollIndicator={false}
        style={styles.pills}
        contentContainerStyle={styles.pillsList}
        initialNumToRender={8}
      />
      <View style={styles.ruler}>
        <Text style={styles.day}>{dayLabel(from, now)}</Text>
        {pxPerMs > 0
          ? slots.map((slot) => (
              <Text key={slot} style={[styles.slot, { left: CHANNEL_W * uiScale + (slot - from) * pxPerMs }]}>
                {clock(slot)}
              </Text>
            ))
          : null}
      </View>
      <TVFocusGuideView style={styles.grid} onLayout={onLayout}>
        {channels.length === 0 ? (
          <Text style={styles.empty}>No channels in this list.</Text>
        ) : pxPerMs > 0 ? (
          <FlatList
            data={channels}
            keyExtractor={(channel) => channel.id}
            renderItem={renderRow}
            extraData={renderRow}
            getItemLayout={(_, index) => ({ length: ROW_H * uiScale, offset: ROW_H * uiScale * index, index })}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            showsVerticalScrollIndicator={false}
          />
        ) : null}
        {nowX !== null ? <View style={[styles.nowLine, { left: nowX }]} pointerEvents="none" /> : null}
      </TVFocusGuideView>
    </View>
  );
}

function dayLabel(at: number, now: number): string {
  const day = new Date(at);
  const today = new Date(now);
  const tomorrow = new Date(now + 24 * 60 * MINUTE);
  if (day.toDateString() === today.toDateString()) return "Today";
  if (day.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return day.toLocaleDateString(undefined, { weekday: "long" });
}

/** The block the remote is on, spelled out above the grid. */
const Details = memo(function Details({ focused, now }: { focused: Focused | null; now: number }) {
  if (focused === null) return <View style={styles.details} />;
  const airing = focused.segment.airing;
  const when =
    airing === null
      ? null
      : airing.start <= now && now < airing.end
        ? `On now   ${clock(airing.start)} to ${clock(airing.end)}   ${Math.max(1, Math.round((airing.end - now) / MINUTE))} min left`
        : `${dayLabel(airing.start, now) === "Today" ? "" : `${dayLabel(airing.start, now)} `}${clock(airing.start)} to ${clock(airing.end)}`;
  return (
    <View style={styles.details}>
      <Text style={styles.detailsChannel} numberOfLines={1}>
        {focused.channel.channel_number !== null ? `${focused.channel.channel_number}  ${focused.channel.normalised_name}` : focused.channel.normalised_name}
      </Text>
      <Text style={styles.detailsTitle} numberOfLines={1}>
        {airing?.title ?? (focused.segment.empty === "loading" ? "Loading the guide…" : "No listings for this time")}
      </Text>
      <Text style={styles.detailsWhen} numberOfLines={1}>
        {when !== null ? `${when}   ·   OK to watch ${focused.channel.normalised_name}` : `OK to watch ${focused.channel.normalised_name}`}
      </Text>
    </View>
  );
});

/** One channel's row: its logo and name, then its programmes laid out along the time axis. */
const GuideRow = memo(function GuideRow({
  channel,
  from,
  to,
  pxPerMs,
  now,
  preferredAt,
  onFocusCell,
  onLeaveCell,
  onPlay,
}: {
  channel: ChannelRow;
  from: number;
  to: number;
  pxPerMs: number;
  now: number;
  preferredAt: number | null;
  onFocusCell: (focused: Focused, again: boolean) => void;
  onLeaveCell: (channelId: string, key: string) => void;
  onPlay: (channel: ChannelRow) => void;
}) {
  const { db } = useApp();
  const [airings, setAirings] = useState<readonly Airing[] | null>(() => knownListings(channel.id) ?? null);
  useEffect(() => {
    let live = true;
    fetchListings(db, channel.id).then((found) => {
      if (live) setAirings(found);
    });
    return () => {
      live = false;
    };
  }, [db, channel.id]);

  const segments = useMemo(() => segmentsFor(airings, from, to), [airings, from, to]);
  return (
    <View style={styles.row}>
      <View style={styles.channel}>
        <View style={styles.logo}>
          <ChannelLogo url={channel.logo_url} name={channel.normalised_name} size={26} recyclingKey={channel.id} />
        </View>
        <Text style={styles.channelName} numberOfLines={2}>
          {channel.normalised_name}
        </Text>
      </View>
      <View style={styles.track}>
        {segments.map((segment, index) => (
          <GuideCell
            key={segment.key}
            channel={channel}
            segment={segment}
            first={index === 0}
            last={index === segments.length - 1}
            left={(segment.start - from) * pxPerMs}
            width={Math.max(2, (segment.end - segment.start) * pxPerMs - 4 * uiScale)}
            clipped={segment.airing !== null && segment.airing.start < from}
            airingNow={segment.airing !== null && segment.airing.start <= now && now < segment.airing.end}
            preferred={preferredAt !== null && segment.start <= preferredAt && preferredAt < segment.end}
            onFocusCell={onFocusCell}
            onLeaveCell={onLeaveCell}
            onPlay={onPlay}
          />
        ))}
      </View>
    </View>
  );
});

/** One block in a row. While the remote is on it, a change to what it shows (its row loaded) is reported again. */
const GuideCell = memo(function GuideCell({
  channel,
  segment,
  first,
  last,
  left,
  width,
  clipped,
  airingNow,
  preferred,
  onFocusCell,
  onLeaveCell,
  onPlay,
}: {
  channel: ChannelRow;
  segment: Segment;
  first: boolean;
  last: boolean;
  left: number;
  width: number;
  clipped: boolean;
  airingNow: boolean;
  preferred: boolean;
  onFocusCell: (focused: Focused, again: boolean) => void;
  onLeaveCell: (channelId: string, key: string) => void;
  onPlay: (channel: ChannelRow) => void;
}) {
  const [focused, setFocused] = useState(false);
  const reported = useRef(false);
  useEffect(() => {
    if (!focused) {
      if (reported.current) onLeaveCell(channel.id, segment.key);
      reported.current = false;
      return;
    }
    onFocusCell({ channel, segment, first, last, at: segment.start }, reported.current);
    reported.current = true;
  }, [focused, channel, segment, first, last, onFocusCell, onLeaveCell]);
  return (
    <Focusable
      preferred={preferred}
      onPress={() => onPlay(channel)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.cell, airingNow && styles.cellNow, segment.airing === null && styles.cellEmpty, { left, width }]}
      focusedStyle={styles.cellFocused}
    >
      <Text style={[styles.cellTitle, focused && styles.cellTitleFocused]} numberOfLines={1}>
        {segment.airing !== null ? `${clipped ? "‹ " : ""}${segment.airing.title}` : segment.empty === "loading" ? "" : "No listings"}
      </Text>
      {segment.airing !== null ? (
        <Text style={[styles.cellTime, focused && styles.cellTimeFocused]} numberOfLines={1}>
          {`${clock(segment.airing.start)} to ${clock(segment.airing.end)}`}
        </Text>
      ) : null}
    </Focusable>
  );
});

const styles = styleSheet({
  page: { flex: 1, paddingHorizontal: 44, paddingTop: 104 },
  details: { height: 150, justifyContent: "flex-end", paddingBottom: 12, gap: 4 },
  detailsChannel: { color: colors.muted, fontSize: 22 },
  detailsTitle: { color: colors.foreground, fontSize: 40, fontWeight: "600", letterSpacing: -0.4 },
  detailsWhen: { color: colors.faint, fontSize: 22 },
  pills: { flexGrow: 0, height: PILL_HEIGHT + 16 },
  pillsList: { gap: 12, paddingVertical: 8 },
  ruler: { height: 44, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.border },
  day: { position: "absolute", left: 8, color: colors.foreground, fontSize: 22, fontWeight: "600" },
  slot: { position: "absolute", color: colors.muted, fontSize: 20, paddingLeft: 8 },
  grid: { flex: 1 },
  empty: { color: colors.muted, fontSize: 24, paddingTop: 40 },
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 3, backgroundColor: colors.live, opacity: 0.8 },
  row: { height: ROW_H, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border },
  channel: { width: CHANNEL_W, flexDirection: "row", alignItems: "center", gap: 14, paddingRight: 12 },
  logo: { width: 96, height: 64, borderRadius: 10, backgroundColor: colors.sunken, overflow: "hidden", padding: 6 },
  channelName: { flex: 1, color: colors.muted, fontSize: 20 },
  track: { flex: 1, height: ROW_H - 12 },
  cell: { position: "absolute", top: 0, bottom: 0, justifyContent: "center", paddingHorizontal: 14, borderRadius: 8, borderWidth: 3, borderColor: "transparent", backgroundColor: colors.raised, overflow: "hidden" },
  cellNow: { backgroundColor: colors.card },
  cellEmpty: { backgroundColor: "transparent", borderColor: colors.border, borderWidth: 1 },
  cellFocused: { backgroundColor: colors.accent, borderColor: colors.accent, borderWidth: 3 },
  cellTitle: { color: colors.foreground, fontSize: 22, fontWeight: "500" },
  cellTitleFocused: { color: colors.accentInk },
  cellTime: { color: colors.faint, fontSize: 18 },
  cellTimeFocused: { color: colors.accentInk },
});
