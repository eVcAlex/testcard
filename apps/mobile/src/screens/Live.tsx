import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { categoryLabel } from "@testcard/core/src/normalise/categoryLabel.js";
import { browseChannels, listCategories, listFavouriteChannels, listRecentChannels, removeChannelFromRecents, toggleFavourite, type ChannelRow } from "@testcard/core/src/db/queries.js";
import { fetchGuide } from "../playback/airing";
import { useApp } from "../state/app";
import { memoByVersion } from "../state/memoByVersion";
import { styleSheet } from "../theme";
import { BrowseScreen, type BrowseItem, type BrowseSource, type Guide } from "./Browse";
import { Loading, useBackTo, useRefreshOnShow } from "./Catalogue";
import { makePinning } from "./pinning";
import { HomeScreen, type HeroActions, type HomeItem, type HomeRow } from "./Home";

const toItem = (channel: ChannelRow): BrowseItem => ({ id: channel.id, title: channel.normalised_name, imageUrl: channel.logo_url, number: channel.channel_number });
export const toHomeItem = (channel: ChannelRow): HomeItem => ({
  id: channel.id,
  name: channel.normalised_name,
  posterUrl: channel.logo_url,
  progress: null,
  rating: null,
  // Filled in from the guide once the remote has rested on the channel.
  plot: null,
  durationSecs: null,
  favourite: channel.is_favourite === 1,
  resume: false,
  channelNumber: channel.channel_number,
});

// Counting every category walks all the channels, so it is done once per sync rather than on every visit.
const channelCategories = memoByVersion((db: Parameters<typeof listCategories>[0], sourceId?: string) =>
  listCategories(db, sourceId)
    .filter((category) => !category.tags.split(" ").some((tag) => tag === "junk" || tag === "separator" || tag === "adult"))
    .map((category) => ({ id: category.id, label: categoryLabel(category.name.normalize("NFKC")), count: category.channel_count, genre: category.genre })),
);

/** How many categories get a row on the landing page; the rest are one press away under Browse all. */
const CATEGORY_ROWS = 10;
const ROW_SIZE = 24;

/** "13:00" from epoch ms. `toLocaleTimeString` is not dependable on every Hermes build. */
const clock = (ms: number): string => {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/**
 * Live TV, laid out like Movies and Series: a hero for the channel the remote rests on (what is airing and
 * what follows, asked of the provider for that one channel) and rows of channel cards under it. Live shows
 * one source at a time, so every row here is that source's. Browse all is the full category list.
 */
export function LiveScreen({
  sourceId,
  active = true,
  browsing,
  onBrowseDone,
  onPlay,
}: {
  sourceId: string | null;
  active?: boolean;
  browsing: boolean;
  onBrowseDone: () => void;
  onPlay: (channel: { id: string; title: string }, channels: readonly { id: string; title: string }[]) => void;
}) {
  const { db, version, sync } = useApp();
  const [tick, setTick] = useState(0);
  useRefreshOnShow(active, useCallback(() => setTick((value) => value + 1), []));
  useBackTo(browsing, onBrowseDone);
  const own = useCallback((channel: ChannelRow) => sourceId === null || channel.source_id === sourceId, [sourceId]);

  const recentIds = useRef(new Set<string>());
  // Reading every row costs a moment on a small device, so the first paint is the outline and the rows follow it.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 30);
    return () => clearTimeout(timer);
  }, []);
  const rows = useMemo<HomeRow[]>(() => {
    void tick;
    if (!ready) return [];
    const categories = channelCategories(db, version, sourceId ?? undefined);
    const scope = sourceId !== null ? { sourceId } : {};
    const recents = listRecentChannels(db, 60).filter(own).slice(0, 30);
    recentIds.current = new Set(recents.map((channel) => channel.id));
    const favourites = listFavouriteChannels(db).filter(own);
    const list: HomeRow[] = [];
    if (recents.length > 0) list.push({ key: "recent", label: "Recently watched", items: recents.map(toHomeItem), channels: true });
    if (favourites.length > 0) list.push({ key: "favourites", label: "Favourites", items: favourites.slice(0, 30).map(toHomeItem), channels: true });
    const sports = browseChannels(db, { genre: "sports", limit: ROW_SIZE, ...scope });
    if (sports.length > 0) list.push({ key: "sports", label: "Sports", items: sports.map(toHomeItem), channels: true });
    for (const category of categories.filter((entry) => entry.count > 0).slice(0, CATEGORY_ROWS)) {
      const channels = browseChannels(db, { categoryId: category.id, limit: ROW_SIZE, ...scope });
      if (channels.length > 0) list.push({ key: category.id, label: category.label, items: channels.map(toHomeItem), channels: true });
    }
    return list;
  }, [db, version, sourceId, tick, own, ready]);

  const fetchDetail = useCallback(
    async (id: string) => {
      const guide = await fetchGuide(db, id);
      if (guide === null) return null;
      const lines = [
        guide.now !== null ? `Now: ${guide.now.title}, ${clock(guide.now.start)} to ${clock(guide.now.end)}` : null,
        guide.next !== null ? `Next: ${guide.next.title}, ${clock(guide.next.start)}` : null,
      ].filter((line): line is string => line !== null);
      return lines.length > 0 ? { plot: lines.join("\n"), durationSecs: null } : null;
    },
    [db],
  );

  const play = useCallback(
    (item: { id: string; name: string }) => {
      // Next and previous step through the row the viewer picked from.
      const row = rows.find((entry) => entry.items.some((candidate) => candidate.id === item.id));
      const stepping = (row?.items ?? [{ id: item.id, name: item.name }]).map((entry) => ({ id: entry.id, title: entry.name }));
      onPlay({ id: item.id, title: item.name }, stepping);
    },
    [rows, onPlay],
  );

  const heroActions = useCallback(
    (item: HomeItem): HeroActions => ({
      primary: { label: "Watch live", onPress: () => play(item) },
      actions: [
        {
          key: "favourite",
          label: item.favourite ? "Remove from Favourites" : "Add to Favourites",
          glyph: item.favourite ? "check" : "plus",
          onPress: () => {
            toggleFavourite(db, item.id);
            sync.notifyLocalChange();
            setTick((value) => value + 1);
          },
        },
        ...(recentIds.current.has(item.id)
          ? [
              {
                key: "forget",
                label: "Remove from Recently watched",
                glyph: "cross" as const,
                onPress: () => {
                  removeChannelFromRecents(db, item.id);
                  setTick((value) => value + 1);
                },
              },
            ]
          : []),
      ],
    }),
    [db, sync, play],
  );

  if (!ready && !browsing) return <Loading noun="channels" />;
  if (browsing || rows.length === 0) return <Browsing sourceId={sourceId} own={own} onPlay={onPlay} />;
  return <HomeScreen rows={rows} heroActions={heroActions} fetchDetail={fetchDetail} onSelect={play} />;
}

/** Every category as a row of pills, channels beneath. */
function Browsing({ sourceId, own, onPlay }: { sourceId: string | null; own: (channel: ChannelRow) => boolean; onPlay: (channel: { id: string; title: string }, channels: readonly { id: string; title: string }[]) => void }) {
  const { db, version, sync } = useApp();
  const source = useMemo<BrowseSource>(() => {
    const scope = sourceId !== null ? { sourceId } : {};
    const categories = channelCategories(db, version, sourceId ?? undefined);
    const favourites = listFavouriteChannels(db).filter(own);
    const recents = listRecentChannels(db, 60).filter(own).slice(0, 30);
    return {
      layout: "channel",
      pinning: makePinning(db, sync, "live"),
      noun: "channels",
      single: "channel",
      genres: false,
      menu: "pills",
      guide: async (id): Promise<Guide | null> => {
        return fetchGuide(db, id);
      },
      specials: [
        { key: "recent", label: "Recently watched", count: recents.length },
        { key: "favourites", label: "Favourites", count: favourites.length },
        { key: "all", label: "All channels", count: categories.reduce((total, category) => total + category.count, 0) },
      ],
      categories,
      load: (selection, limit) => {
        if (selection.kind === "category") return browseChannels(db, { categoryId: selection.key, limit, ...scope }).map(toItem);
        if (selection.kind === "genre") return browseChannels(db, { genre: selection.key, limit, ...scope }).map(toItem);
        if (selection.key === "recent") return recents.slice(0, limit).map(toItem);
        if (selection.key === "favourites") return favourites.slice(0, limit).map(toItem);
        return browseChannels(db, { limit, ...scope }).map(toItem);
      },
    };
  }, [db, version, sourceId, own, sync]);

  return (
    <View style={styles.padded}>
      <BrowseScreen
        source={source}
        empty={sourceId !== null ? "Nothing from this source. Use the Source button at the top right to switch." : "Sources that sync from your account load here. Open Sources to see progress."}
        onSelect={(item, list) => {
          // Next and previous step through the list the viewer picked from; a list of one steps through all channels instead.
          const stepping = list.length > 1 ? list : browseChannels(db, { limit: 300, ...(sourceId !== null ? { sourceId } : {}) }).map(toItem);
          onPlay({ id: item.id, title: item.title }, stepping.map((entry) => ({ id: entry.id, title: entry.title })));
        }}
      />
    </View>
  );
}

const styles = styleSheet({
  padded: { flex: 1, paddingHorizontal: 44, paddingTop: 112 },
});
