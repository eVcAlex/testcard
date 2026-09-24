/**
 * Where one source's import has got to. Live channels come first, then movies, then series; then a sync
 * brings in the watch history and favourites that point at what was just imported.
 */
export type ImportStage = "live" | "movies" | "series" | "saving" | "history" | "done";

export type ContentKind = "live" | "movies" | "series";

export interface ImportProgress {
  readonly name: string;
  /** The kinds of content this source is set to import. */
  readonly wants: { readonly live: boolean; readonly movies: boolean; readonly series: boolean };
  /**
   * What the source is known to hold, for the step's description: a source that is set to import films but has
   * never had any is not described as fetching them. Null when that is not known yet (a playlist on its first load).
   */
  readonly shows: readonly ContentKind[] | null;
  readonly at: ImportStage;
}

export interface SetupStep {
  /** Unique within the list. */
  readonly key: string;
  readonly label: string;
  /** A shorter line beside the label: what a source brings. */
  readonly note?: string;
  readonly state: "done" | "active" | "waiting";
}

/** What the "getting ready" screen shows. */
export interface SetupProgress {
  readonly steps: readonly SetupStep[];
  /** 0 to 1. */
  readonly fraction: number;
  /** One line about what is happening right now. */
  readonly detail: string;
}

const KIND_LABEL: Record<ContentKind, string> = { live: "Live channels", movies: "Movies", series: "Series" };
const DOING: Record<Exclude<ImportStage, "done">, string> = {
  live: "loading live channels",
  movies: "loading movies",
  series: "loading series",
  saving: "finishing up",
  history: "syncing watch history",
};

/** How far through its own import one source is, 0 to 1, counting only the stages it goes through. */
function sourceFraction(entry: ImportProgress): number {
  if (entry.at === "history" || entry.at === "done") return 1;
  const stages: ImportStage[] = [...(["live", "movies", "series"] as const).filter((kind) => entry.wants[kind]), "saving"];
  return (Math.max(0, stages.indexOf(entry.at)) + 0.5) / stages.length;
}

/**
 * The "getting ready" screen: null unless `firstSync` is true, which it is while a signed-in device is
 * waiting for its first sync to bring its sources in, or while any source is importing (the first load
 * or a Refresh). The app waits on it rather than showing a half-loaded catalogue. `launchSync` is the
 * catch-up with the account on every launch: the same screen, with only the watch history to wait for.
 *
 * Each importing source gets its own step, described by what it holds, so a live-only playlist is not shown
 * fetching films. A source that has finished stays ticked until the others are done too.
 */
export function describeSetup({ firstSync, launchSync = false, imports }: { firstSync: boolean; launchSync?: boolean; imports: readonly ImportProgress[] }): SetupProgress | null {
  if (!firstSync) {
    if (!launchSync) return null;
    return {
      steps: [
        { key: "account", label: "Account secured", state: "done" },
        { key: "sources", label: "Your sources", state: "done" },
        { key: "history", label: "Watch history", note: "From your other devices", state: "active" },
      ],
      fraction: 0.8,
      detail: "Syncing watch history and favourites",
    };
  }
  const sourceSteps = imports.map(
    (entry, index): SetupStep => ({
      key: `source${index}`,
      label: entry.name,
      note: entry.shows === null ? "Playlist" : entry.shows.length > 0 ? entry.shows.map((kind) => KIND_LABEL[kind]).join(" · ") : "Nothing to load",
      state: entry.at === "history" || entry.at === "done" ? "done" : "active",
    }),
  );
  const allDone = imports.length > 0 && imports.every((entry) => entry.at === "done");
  const historyState: SetupStep["state"] = allDone ? "done" : imports.some((entry) => entry.at === "history") ? "active" : "waiting";
  const steps: SetupStep[] = [
    { key: "account", label: "Account secured", state: "done" },
    { key: "sources", label: "Your sources", state: imports.length > 0 ? "done" : "active" },
    ...sourceSteps,
    { key: "history", label: "Watch history", state: historyState },
  ];
  const score =
    1 +
    (imports.length > 0 ? 1 : 0.5) +
    imports.reduce((total, entry) => total + sourceFraction(entry), 0) +
    (historyState === "done" ? 1 : historyState === "active" ? 0.5 : 0);
  const current = imports.find((entry) => entry.at !== "done");
  // Said in the step's terms: a live-only playlist passes through the film and series stages (nothing to load
  // there) and should not claim to be loading films; a playlist on its first load is one download, whatever it holds.
  const doing = (entry: ImportProgress): string => {
    if (entry.at === "live" || entry.at === "movies" || entry.at === "series") {
      if (entry.shows === null) return "loading the playlist";
      if (!entry.shows.includes(entry.at)) return DOING.saving;
    }
    return DOING[entry.at as Exclude<ImportStage, "done">];
  };
  return {
    steps,
    fraction: Math.min(1, score / steps.length),
    detail:
      current === undefined
        ? imports.length === 0
          ? "Fetching your sources"
          : "Almost there"
        : `${current.name}: ${doing(current)}`,
  };
}
