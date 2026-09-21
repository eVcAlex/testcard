import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type Database from "better-sqlite3";
import { SyncController, type SyncStatus } from "@testcard/core/src/sync/syncController.js";
import { removeSourceRows } from "@testcard/core/src/sync/sourceRemoval.js";
import { importCatalogue, type CatalogueSource } from "@testcard/core/src/db/importCatalogue.js";
import { createM3UAdapter } from "@testcard/core/src/source/m3u/adapter.js";
import { createXtreamAdapter } from "@testcard/core/src/source/xtream/client.js";
import { openAppDatabase } from "../platform/sqlite";
import { deleteCredentials, getCredentials, syncPlatform } from "../platform/secrets";

export interface SourceSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: "xtream" | "m3u";
  readonly lastRefreshedAt: number | null;
  readonly channels: number;
  readonly movies: number;
  readonly series: number;
  readonly refreshing: boolean;
  readonly error: string | undefined;
}

interface AppState {
  readonly db: Database.Database;
  readonly sync: SyncController;
  readonly status: SyncStatus;
  /** Bumps whenever stored data may have changed (sync applied, a source imported), so screens re-query. */
  readonly version: number;
  readonly sources: readonly SourceSummary[];
  refreshSource(sourceId: string): Promise<void>;
  /** Takes a source off this device and, through sync, off the user's others. */
  removeSource(sourceId: string): Promise<void>;
  updateStatus(): void;
}

const AppContext = createContext<AppState | undefined>(undefined);

const adapters = () => ({
  xtreamAdapter: createXtreamAdapter(getCredentials),
  m3uAdapter: createM3UAdapter(),
  getCredentials,
});

/** Owns the database and the sync loop for the life of the app. */
export function AppProvider({ children }: { children: ReactNode }) {
  const dbRef = useRef<Database.Database | undefined>(undefined);
  dbRef.current ??= openAppDatabase();
  const db = dbRef.current;

  const [version, setVersion] = useState(0);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const bump = useCallback(() => setVersion((current) => current + 1), []);

  // A second import of a source that is already importing would interleave with the first.
  const inFlight = useRef(new Set<string>());

  const refreshSource = useCallback(
    async (sourceId: string) => {
      if (inFlight.current.has(sourceId)) return;
      const row = db
        .prepare(
          `SELECT id, kind, name, base_url AS baseUrl, playlist_url AS playlistUrl, epg_url AS epgUrl,
                  include_live AS includeLive, include_movies AS includeMovies, include_series AS includeSeries
           FROM sources WHERE id = ?`,
        )
        .get(sourceId) as unknown as CatalogueSource | undefined;
      if (row === undefined) return;
      inFlight.current.add(sourceId);
      setRefreshing((current) => new Set(current).add(sourceId));
      setErrors(({ [sourceId]: _cleared, ...rest }) => rest);
      try {
        await importCatalogue(db, row, adapters());
      } catch (error) {
        const message = error instanceof Error ? error.message : "The import failed.";
        setErrors((current) => ({ ...current, [sourceId]: message }));
      } finally {
        inFlight.current.delete(sourceId);
        setRefreshing((current) => {
          const next = new Set(current);
          next.delete(sourceId);
          return next;
        });
        bump();
      }
    },
    [db, bump],
  );

  const syncRef = useRef<SyncController | undefined>(undefined);
  const refreshRef = useRef(refreshSource);
  refreshRef.current = refreshSource;
  syncRef.current ??= new SyncController(db, syncPlatform, (ids) => {
    // Sources that arrived from another device have no channels yet: import them now.
    for (const id of ids) void refreshRef.current(id);
  });
  const sync = syncRef.current;

  const removeSource = useCallback(
    async (sourceId: string) => {
      removeSourceRows(db, sourceId, { recordTombstone: true });
      await deleteCredentials(sourceId).catch(() => undefined);
      sync.notifyLocalChange();
      bump();
    },
    [db, sync, bump],
  );

  const [status, setStatus] = useState<SyncStatus>(() => sync.status());
  const updateStatus = useCallback(() => {
    setStatus(sync.status());
    bump();
  }, [sync, bump]);

  // Poll the sync status; when a sync has landed (new favourites, progress, sources), re-query.
  const lastSyncedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = sync.status();
      setStatus(next);
      if (next.lastSyncedAt !== lastSyncedAt.current) {
        lastSyncedAt.current = next.lastSyncedAt;
        bump();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [sync, bump]);
  useEffect(() => () => sync.dispose(), [sync]);

  const sources = useMemo<SourceSummary[]>(() => {
    void version;
    const rows = db
      .prepare(`SELECT id, kind, name, last_refreshed_at AS lastRefreshedAt FROM sources ORDER BY sort_order IS NULL, sort_order, created_at`)
      .all() as unknown as { id: string; kind: "xtream" | "m3u"; name: string; lastRefreshedAt: number | null }[];
    const count = (table: string, id: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE source_id = ?`).get(id) as unknown as { n: number }).n;
    return rows.map((row) => ({
      ...row,
      channels: count("channels", row.id),
      movies: count("movies", row.id),
      series: count("series", row.id),
      refreshing: refreshing.has(row.id),
      error: errors[row.id],
    }));
  }, [db, version, refreshing, errors]);

  const value = useMemo<AppState>(
    () => ({ db, sync, status, version, sources, refreshSource, removeSource, updateStatus }),
    [db, sync, status, version, sources, refreshSource, removeSource, updateStatus],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (value === undefined) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}
