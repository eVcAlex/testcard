import type Database from "better-sqlite3";
import type { SyncController } from "@testcard/core/src/sync/syncController.js";
import { pinCategory, pinnedCategoryIds, unpinCategory, type PinKind } from "@testcard/core/src/sync/sourcePins.js";
import { hideCategory } from "@testcard/core/src/sync/hidden.js";

/**
 * What a category browser needs to offer "Pin to Home" and "Hide" for one kind of content. Every change is synced;
 * `changed` is told after a hide, so the lists are read again without it.
 */
export function makePinning(db: Database.Database, sync: SyncController, kind: PinKind, changed: () => void) {
  return {
    hide: (categoryId: string, label: string) => {
      if (pinnedCategoryIds(db, kind).has(categoryId)) unpinCategory(db, kind, categoryId);
      hideCategory(db, kind, categoryId, label);
      sync.notifyLocalChange();
      changed();
    },
    isPinned: (categoryId: string) => pinnedCategoryIds(db, kind).has(categoryId),
    toggle: (categoryId: string, label: string) => {
      if (pinnedCategoryIds(db, kind).has(categoryId)) unpinCategory(db, kind, categoryId);
      else pinCategory(db, kind, categoryId, label);
      sync.notifyLocalChange();
    },
  };
}
