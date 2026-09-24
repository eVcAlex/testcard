import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState as AppLifecycle } from "react-native";
import type Database from "better-sqlite3";
import { SyncController, type SyncStatus } from "@testcard/core/src/sync/syncController.js";
import { removeSourceRows } from "@testcard/core/src/sync/sourceRemoval.js";
import { importCatalogue, type CatalogueSource } from "@testcard/core/src/db/importCatalogue.js";
import { createM3UAdapter } from "@testcard/core/src/source/m3u/adapter.js";
import { createXtreamAdapter } from "@testcard/core/src/source/xtream/client.js";
import { openAppDatabase } from "../platform/sqlite";
import { deleteCredentials, getCredentials, syncPlatform } from "../platform/secrets";
import { readCaptionPrefs, writeCaptionPrefs, type CaptionPrefs } from "../playback/captions";
import { readAudioLanguage, writeAudioLanguage } from "../playback/viewing";
import { describeSetup, type ContentKind, type ImportProgress, type ImportStage, type SetupProgress } from "./setup";

/** Something a source's last import could not load: its movies, its series, or (a thrown import) all of it. */
export interface SourceFailure {
  readonly part: "movies" | "series" | "all";
  readonly message: string;
}

export interface SourceSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: "xtream" | "m3u";
  readonly lastRefreshedAt: number | null;
  readonly channels: number;
  readonly movies: number;
  readonly series: number;
  readonly refreshing: boolean;
  /** Empty unless the last import failed, in part or whole. */
  readonly failures: readonly SourceFailure[];
}

interface AppState {
  readonly db: Database.Database;
  readonly sync: SyncController;
  readonly status: SyncStatus;
  /** Bumps whenever stored data may have changed (sync applied, a source imported), so screens re-query. */
  readonly version: number;
  /**
   * Changes only when the catalogue does (a source imported, added or removed), never for favourites or progress.
   * Reads that walk the whole catalogue key on this, so a sync that only brought history does not rebuild them.
   */
  readonly catalogue: string;
  readonly sources: readonly SourceSummary[];
  /** Set while this device is fetching its data for the first time or refreshing a source: the app waits on it. */
  readonly setup: SetupProgress | null;
  /** True while the app is catching up with the account on launch or on coming back to the front. */
  readonly syncing: boolean;
  /** How captions look and whether films and episodes start with them on. This device only. */
  readonly captions: CaptionPrefs;
  setCaptions(prefs: CaptionPrefs): void;
  /** The two-letter language of the soundtrack last picked in the player, chosen again when a film offers it. This device only. */
  readonly audioLanguage: string | null;
  setAudioLanguage(language: string | null): void;
  refreshSource(sourceId: string): Promise<void>;
  /** Takes a source off this device and, through sync, off the user's others. */
  removeSource(sourceId: string): Promise<void>;
  updateStatus(): void;
}

const noFailures: readonly SourceFailure[] = [];

/** The launch catch-up holds the app at most this long; after that it carries on with "Syncing" in the nav bar. */
const LAUNCH_SYNC_WAIT_MS = 10_000;
/** And the getting-ready screen stays at least this long once it is up, so a quick sync does not flash it. */
const LAUNCH_SYNC_SHOW_MS = 700;

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
  const [progress, setProgress] = useState<ReadonlyMap<string, ImportProgress>>(new Map());
  const stage = useCallback((sourceId: string, at: ImportStage) => {
    setProgress((current) => {
      const entry = current.get(sourceId);
      return entry === undefined || entry.at === at ? current : new Map(current).set(sourceId, { ...entry, at });
    });
  }, []);
  const [errors, setErrors] = useState<Readonly<Record<string, readonly SourceFailure[]>>>({});
  const bump = useCallback(() => setVersion((current) => current + 1), []);

  // A second import of a source that is already importing would interleave with the first; a removal waits for it.
  const inFlight = useRef(new Map<string, Promise<void>>());

  const importSource = useCallback(
    async (sourceId: string) => {
      const row = db
        .prepare(
          `SELECT id, kind, name, base_url AS baseUrl, playlist_url AS playlistUrl, epg_url AS epgUrl,
                  include_live AS includeLive, include_movies AS includeMovies, include_series AS includeSeries,
                  last_refreshed_at AS lastRefreshedAt,
                  (SELECT COUNT(*) FROM channels WHERE source_id = sources.id) AS channelCount,
                  (SELECT COUNT(*) FROM movies WHERE source_id = sources.id) AS movieCount,
                  (SELECT COUNT(*) FROM series WHERE source_id = sources.id) AS seriesCount
           FROM sources WHERE id = ?`,
        )
        .get(sourceId) as unknown as
        | (CatalogueSource & { lastRefreshedAt: number | null; channelCount: number; movieCount: number; seriesCount: number })
        | undefined;
      if (row === undefined) return;
      const wants = { live: row.includeLive !== 0, movies: row.includeMovies !== 0, series: row.includeSeries !== 0 };
      // Described by what it held last time: a playlist set to import films that has never had any is live-only.
      // A playlist's first load cannot know; an Xtream source's lists are fetched separately, so its settings say.
      const held: Record<ContentKind, number> = { live: row.channelCount, movies: row.movieCount, series: row.seriesCount };
      const kinds = (["live", "movies", "series"] as const).filter((kind) => wants[kind]);
      const shows = row.lastRefreshedAt !== null ? kinds.filter((kind) => held[kind] > 0) : row.kind === "xtream" ? kinds : null;
      setProgress((current) =>
        new Map(current).set(sourceId, { name: row.name, wants, shows, at: wants.live ? "live" : wants.movies ? "movies" : wants.series ? "series" : "saving" }),
      );
      setRefreshing((current) => new Set(current).add(sourceId));
      setErrors(({ [sourceId]: _cleared, ...rest }) => rest);
      // Movies and series are best-effort (the import carries on without them), so their failures arrive
      // as events rather than a throw. Kept on the row, or a VOD-only source just reads "Nothing loaded yet".
      const failed = (part: SourceFailure["part"], message: string) => {
        console.warn(`Import of ${row.name} failed (${part}): ${message}`);
        setErrors((current) => ({ ...current, [sourceId]: [...(current[sourceId] ?? []), { part, message }] }));
      };
      try {
        await importCatalogue(db, row, adapters(), {
          live: ({ phase }) => {
            if (phase === "done") stage(sourceId, wants.movies ? "movies" : wants.series ? "series" : "saving");
          },
          vod: (event) => {
            if (event.phase === "error") failed("movies", event.message ?? "The provider sent nothing back.");
            stage(sourceId, event.phase === "fetching" ? "movies" : wants.series ? "series" : "saving");
          },
          series: (event) => {
            if (event.phase === "error") failed("series", event.message ?? "The provider sent nothing back.");
            stage(sourceId, event.phase === "fetching" ? "series" : "saving");
          },
        });
        // Favourites, recents and progress that point at titles not imported yet were held back by the sync
        // until they exist. Now they do: sync straight away, rather than on the next periodic tick a minute on,
        // so the app opens with its history in place.
        stage(sourceId, "history");
        await syncRef.current?.triggerNow().catch(() => undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The import failed.";
        console.warn(`Import of ${row.name} failed: ${message}`);
        setErrors((current) => ({ ...current, [sourceId]: [{ part: "all", message }] }));
      } finally {
        // Kept, ticked, until every source importing alongside it is done; then the setup screen goes.
        setProgress((current) => {
          const entry = current.get(sourceId);
          const next = entry === undefined ? new Map(current) : new Map(current).set(sourceId, { ...entry, at: "done" });
          return [...next.values()].every((other) => other.at === "done") ? new Map() : next;
        });
        setRefreshing((current) => {
          const next = new Set(current);
          next.delete(sourceId);
          return next;
        });
        bump();
      }
    },
    [db, bump, stage],
  );
  const refreshSource = useCallback(
    (sourceId: string) => {
      const running = inFlight.current.get(sourceId);
      if (running !== undefined) return running;
      const run = importSource(sourceId).finally(() => inFlight.current.delete(sourceId));
      inFlight.current.set(sourceId, run);
      return run;
    },
    [importSource],
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
      // Removed mid-import, the import's next write would hit a source that is gone and report a failure.
      await inFlight.current.get(sourceId)?.catch(() => undefined);
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

  // Poll the sync status; when a sync has brought something in (new favourites, progress, sources), re-query.
  // A sync that found nothing new leaves the screens alone, so they are not rebuilt every minute for no reason.
  const lastChangedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = sync.status();
      // A new object every few seconds would re-render every screen that reads the app state; only a real change does.
      setStatus((previous) =>
        previous.account === next.account && previous.email === next.email && previous.lastSyncedAt === next.lastSyncedAt && previous.lastChangedAt === next.lastChangedAt && previous.lastError === next.lastError ? previous : next,
      );
      if (next.lastChangedAt !== lastChangedAt.current) {
        lastChangedAt.current = next.lastChangedAt;
        bump();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [sync, bump]);
  useEffect(() => () => sync.dispose(), [sync]);
  // On launch, and whenever the app comes back to the front, catch up with the account at once, so what was watched
  // or changed on another device is there when the viewer looks. (Android holds JS timers in the background, so the
  // periodic sync can be well overdue.) The screens re-read as soon as it lands rather than on the next status
  // poll, and the nav bar says it is happening.
  const [syncing, setSyncing] = useState(false);
  // The catch-up on launch is waited on behind the getting-ready screen, as a refresh is, so the first thing on
  // screen already has what was watched elsewhere. Held up at most LAUNCH_SYNC_WAIT_MS (a slow or absent network
  // should not keep the app shut), and shown for at least LAUNCH_SYNC_SHOW_MS so a quick one does not flash.
  const [launching, setLaunching] = useState(() => sync.status().account === "signed-in");
  const catchUp = useCallback(
    (onLaunch: boolean) => {
      if (sync.status().account !== "signed-in") {
        if (onLaunch) setLaunching(false);
        return;
      }
      setSyncing(true);
      const shownFrom = Date.now();
      const cap = onLaunch ? setTimeout(() => setLaunching(false), LAUNCH_SYNC_WAIT_MS) : undefined;
      sync
        .triggerNow()
        .then(updateStatus, () => undefined)
        .finally(() => {
          setSyncing(false);
          if (!onLaunch) return;
          clearTimeout(cap);
          setTimeout(() => setLaunching(false), Math.max(0, LAUNCH_SYNC_SHOW_MS - (Date.now() - shownFrom)));
        });
    },
    [sync, updateStatus],
  );
  useEffect(() => {
    catchUp(true);
    const subscription = AppLifecycle.addEventListener("change", (state) => {
      if (state === "active") catchUp(false);
    });
    return () => subscription.remove();
  }, [catchUp]);

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
      failures: errors[row.id] ?? noFailures,
    }));
  }, [db, version, refreshing, errors]);

  const catalogue = useMemo(() => sources.map((entry) => `${entry.id}:${entry.lastRefreshedAt ?? 0}`).join(","), [sources]);

  // The app waits while a signed-in device with no sources is waiting for its first sync, and while anything is
  // importing: the sync only brings the source rows down, and importing their channels, movies and series (the
  // slow part) follows, on the first load and on every Refresh.
  const signedIn = status.account === "signed-in";
  const waitingForSources = sources.length === 0 && status.lastSyncedAt === undefined && status.lastError === undefined;
  const firstSync = signedIn && (waitingForSources || progress.size > 0);
  const setup = useMemo(() => describeSetup({ firstSync, launchSync: signedIn && launching, imports: [...progress.values()] }), [firstSync, signedIn, launching, progress]);

  const [captions, setCaptionsState] = useState<CaptionPrefs>(() => readCaptionPrefs(db));
  const setCaptions = useCallback(
    (prefs: CaptionPrefs) => {
      setCaptionsState(prefs);
      writeCaptionPrefs(db, prefs);
    },
    [db],
  );
  const [audioLanguage, setAudioLanguageState] = useState<string | null>(() => readAudioLanguage(db));
  const setAudioLanguage = useCallback(
    (language: string | null) => {
      setAudioLanguageState(language);
      writeAudioLanguage(db, language);
    },
    [db],
  );

  const value = useMemo<AppState>(
    () => ({ db, sync, status, version, catalogue, sources, setup, syncing, captions, setCaptions, audioLanguage, setAudioLanguage, refreshSource, removeSource, updateStatus }),
    [db, sync, status, version, catalogue, sources, setup, syncing, captions, setCaptions, audioLanguage, setAudioLanguage, refreshSource, removeSource, updateStatus],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (value === undefined) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}
