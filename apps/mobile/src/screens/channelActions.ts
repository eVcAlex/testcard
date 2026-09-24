import type Database from "better-sqlite3";
import type { SyncController } from "@testcard/core/src/sync/syncController.js";
import { listFavouriteChannels, moveFavourite } from "@testcard/core/src/db/queries.js";
import { hideChannel } from "@testcard/core/src/sync/hidden.js";
import type { DetailAction } from "../ui/DetailActions";

/**
 * What a channel's card offers beyond playing and favouriting: moving it along the Favourites row (from that row),
 * and hiding it. The order is this TV's own, as favourite channels are; hiding is synced.
 */
export function channelExtras(db: Database.Database, sync: SyncController, channel: { id: string; name: string }, inFavouritesRow: boolean, changed: () => void): DetailAction[] {
  const actions: DetailAction[] = [];
  if (inFavouritesRow) {
    const order = listFavouriteChannels(db).map((row) => row.id);
    const at = order.indexOf(channel.id);
    if (at > 0) actions.push({ key: "earlier", label: "Move earlier in Favourites", glyph: "earlier", onPress: () => moveFavourite(db, channel.id, -1) && changed() });
    if (at >= 0 && at < order.length - 1) actions.push({ key: "later", label: "Move later in Favourites", glyph: "later", onPress: () => moveFavourite(db, channel.id, 1) && changed() });
  }
  actions.push({
    key: "hide",
    label: "Hide this channel",
    glyph: "hide",
    onPress: () => {
      if (!hideChannel(db, channel.id, channel.name)) return;
      sync.notifyLocalChange();
      changed();
    },
  });
  return actions;
}
