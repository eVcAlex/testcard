import type Database from "better-sqlite3";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Runs each source's refresh on its own configured interval (see `sources.update` /
 * `SourceForm`'s interval select). Checked on a 15-minute tick rather than one timer per
 * source — a source's interval can be edited or the source removed at any time, and
 * re-deriving "what's due" from the DB on each tick is simpler than reconciling a live set of
 * per-source timers against that. Serial, not parallel: refreshing several providers back to
 * back at once is exactly the "hammering a provider" a bulk auto-refresh could otherwise cause.
 *
 * `refreshSource` is expected to no-op (or reject harmlessly) for a source already mid-refresh
 * — see `ipc.ts`'s `refreshingSourceIds` guard — so a slow manual refresh and a due tick can't
 * double-run the same source.
 */
export function startRefreshScheduler(
  db: Database.Database,
  refreshSource: (sourceId: string) => Promise<unknown>,
): () => void {
  let stopped = false;

  async function tick(): Promise<void> {
    const due = db
      .prepare(
        `SELECT id FROM sources
         WHERE refresh_interval_hours IS NOT NULL
           AND (last_refreshed_at IS NULL OR last_refreshed_at + refresh_interval_hours * 3600000 < ?)`,
      )
      .all(Date.now()) as { id: string }[];

    for (const { id } of due) {
      if (stopped) return;
      // One provider's failure (network blip, expired credentials) must not stop the round —
      // sources.refresh already turns its own errors into task events for the sidebar.
      await refreshSource(id).catch(() => undefined);
    }
  }

  void tick();
  const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
