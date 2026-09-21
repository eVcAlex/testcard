/** Where one source's import has got to. Live channels come first, then movies, then series. */
export type ImportStage = "live" | "movies" | "series" | "saving";

export interface ImportProgress {
  readonly name: string;
  /** The kinds of content this source is set to import. */
  readonly wants: { readonly live: boolean; readonly movies: boolean; readonly series: boolean };
  readonly at: ImportStage;
}

export interface SetupStep {
  readonly label: string;
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

const ORDER: readonly ImportStage[] = ["live", "movies", "series", "saving"];

/**
 * The first-run and refresh screen: null when there is nothing to wait for. `firstSync` is true while a signed-in
 * device that has no sources yet is waiting for its first sync to bring them in.
 */
export function describeSetup({ firstSync, imports }: { firstSync: boolean; imports: readonly ImportProgress[] }): SetupProgress | null {
  if (!firstSync && imports.length === 0) return null;
  const wants = {
    live: imports.length === 0 || imports.some((entry) => entry.wants.live),
    movies: imports.length === 0 || imports.some((entry) => entry.wants.movies),
    series: imports.length === 0 || imports.some((entry) => entry.wants.series),
  };
  // A content step is done once every importing source is past it, active while any one is on it.
  const stateOf = (stage: ImportStage): SetupStep["state"] => {
    if (imports.length === 0) return "waiting";
    const at = imports.map((entry) => ORDER.indexOf(entry.at));
    const index = ORDER.indexOf(stage);
    if (at.some((position) => position === index)) return "active";
    return at.every((position) => position > index) ? "done" : "waiting";
  };
  const steps: SetupStep[] = [
    { label: "Account secured", state: "done" },
    { label: "Your sources", state: imports.length > 0 ? "done" : "active" },
    ...(wants.live ? [{ label: "Live channels", state: stateOf("live") }] : []),
    ...(wants.movies ? [{ label: "Movies", state: stateOf("movies") }] : []),
    ...(wants.series ? [{ label: "Series", state: stateOf("series") }] : []),
  ];
  const score = steps.reduce((total, step) => total + (step.state === "done" ? 1 : step.state === "active" ? 0.5 : 0), 0);
  const current = imports[0];
  const doing = { live: "live channels", movies: "movies", series: "series", saving: "finishing up" } as const;
  return {
    steps,
    fraction: Math.min(1, score / steps.length),
    detail: current === undefined ? "Fetching your sources" : `${current.name}: ${current.at === "saving" ? doing.saving : `loading ${doing[current.at]}`}`,
  };
}
