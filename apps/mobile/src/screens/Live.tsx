import { useMemo } from "react";
import { categoryLabel } from "@testcard/core/src/normalise/categoryLabel.js";
import { browseChannels, getPlaybackTarget, listCategories, listFavouriteChannels, listRecentChannels, type ChannelRow } from "@testcard/core/src/db/queries.js";
import { fetchShortEpg } from "@testcard/core/src/source/xtream/client.js";
import { getCredentials } from "../platform/secrets";
import { useApp } from "../state/app";
import { memoByVersion } from "../state/memoByVersion";
import { BrowseScreen, type BrowseItem, type BrowseSource, type Guide } from "./Browse";

const toItem = (channel: ChannelRow): BrowseItem => ({ id: channel.id, title: channel.normalised_name, imageUrl: channel.logo_url, number: channel.channel_number });

// Counting every category walks all the channels, so it is done once per sync rather than on every visit.
const channelCategories = memoByVersion((db: Parameters<typeof listCategories>[0], sourceId?: string) =>
  listCategories(db, sourceId)
    .filter((category) => !category.tags.split(" ").some((tag) => tag === "junk" || tag === "separator" || tag === "adult"))
    .map((category) => ({ id: category.id, label: categoryLabel(category.name.normalize("NFKC")), count: category.channel_count, genre: category.genre })),
);

/**
 * Live TV: recent and favourites first, then every category the provider ships, channels on the right.
 * There is no full guide on the TV app; the channel the remote rests on shows what is airing and what is next,
 * asked of the provider for that one channel.
 */
export function LiveScreen({ sourceId, onPlay }: { sourceId: string | null; onPlay: (channel: { id: string; title: string }, channels: readonly { id: string; title: string }[]) => void }) {
  const { db, version } = useApp();
  const source = useMemo<BrowseSource>(() => {
    const scope = sourceId !== null ? { sourceId } : {};
    const categories = channelCategories(db, version, sourceId ?? undefined);
    const favourites = listFavouriteChannels(db);
    const recents = listRecentChannels(db, 30);
    return {
      layout: "channel",
      noun: "channels",
      single: "channel",
      guide: async (id): Promise<Guide | null> => {
        const target = getPlaybackTarget(db, id);
        if (target === undefined || target.source.kind !== "xtream") return null;
        const at = Date.now();
        const listings = await fetchShortEpg(target.source, target.variant.providerStreamId, getCredentials);
        const now = listings.find((entry) => entry.start.getTime() <= at && at < entry.end.getTime());
        const next = listings.find((entry) => entry.start.getTime() > at);
        if (now === undefined && next === undefined) return null;
        return {
          now: now !== undefined ? { title: now.title, start: now.start.getTime(), end: now.end.getTime() } : null,
          next: next !== undefined ? { title: next.title, start: next.start.getTime() } : null,
        };
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
  }, [db, version, sourceId]);

  return (
    <BrowseScreen
      source={source}
      empty={sourceId !== null ? "Nothing from this source. Use the Source button at the top right to switch." : "Sources that sync from your account load here. Open Sources to see progress."}
      onSelect={(item, list) => {
        // Next and previous step through the list the viewer picked from; a list of one steps through all channels instead.
        const stepping = list.length > 1 ? list : browseChannels(db, { limit: 300, ...(sourceId !== null ? { sourceId } : {}) }).map(toItem);
        onPlay({ id: item.id, title: item.title }, stepping.map((entry) => ({ id: entry.id, title: entry.title })));
      }}
    />
  );
}
