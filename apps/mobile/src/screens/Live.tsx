import { useMemo } from "react";
import { categoryLabel } from "@testcard/core/src/normalise/categoryLabel.js";
import { browseChannels, listCategories, listFavouriteChannels, type ChannelRow } from "@testcard/core/src/db/queries.js";
import { useApp } from "../state/app";
import { memoByVersion } from "../state/memoByVersion";
import { BrowseScreen, type BrowseItem, type BrowseSource } from "./Browse";

const toItem = (channel: ChannelRow): BrowseItem => ({ id: channel.id, title: channel.normalised_name, imageUrl: channel.logo_url, number: channel.channel_number });

// Counting every category walks all the channels, so it is done once per sync rather than on every visit.
const channelCategories = memoByVersion((db: Parameters<typeof listCategories>[0]) =>
  listCategories(db)
    .filter((category) => !category.tags.split(" ").some((tag) => tag === "junk" || tag === "separator" || tag === "adult"))
    .map((category) => ({ id: category.id, label: categoryLabel(category.name.normalize("NFKC")), count: category.channel_count, genre: category.genre })),
);

/**
 * Live TV: favourites first, then every category the provider ships, channels on the right.
 * No guide yet on the TV app: channels show their name and number.
 */
export function LiveScreen({ onPlay }: { onPlay: (channel: { id: string; title: string }, channels: readonly { id: string; title: string }[]) => void }) {
  const { db, version } = useApp();
  const source = useMemo<BrowseSource>(() => {
    const categories = channelCategories(db, version);
    const favourites = listFavouriteChannels(db);
    return {
      layout: "channel",
      noun: "channels",
      single: "channel",
      specials: [
        { key: "favourites", label: "Favourites", count: favourites.length },
        { key: "all", label: "All channels", count: categories.reduce((total, category) => total + category.count, 0) },
      ],
      categories,
      load: (selection, limit) => {
        if (selection.kind === "category") return browseChannels(db, { categoryId: selection.key, limit }).map(toItem);
        if (selection.kind === "genre") return browseChannels(db, { genre: selection.key, limit }).map(toItem);
        if (selection.key === "favourites") return favourites.slice(0, limit).map(toItem);
        return browseChannels(db, { limit }).map(toItem);
      },
    };
  }, [db, version]);

  return (
    <BrowseScreen
      source={source}
      empty="Sources that sync from your account load here. Open Sources to see progress."
      onSelect={(item, list) => {
        // Next and previous step through the list the viewer picked from; a list of one steps through all channels instead.
        const stepping = list.length > 1 ? list : browseChannels(db, { limit: 300 }).map(toItem);
        onPlay({ id: item.id, title: item.title }, stepping.map((entry) => ({ id: entry.id, title: entry.title })));
      }}
    />
  );
}
