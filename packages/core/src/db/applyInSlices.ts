import type Database from "better-sqlite3";

/**
 * How long to hold off before the next slice. The Fire TV app sets it so a slice waits while the remote is being
 * used; by default there is no wait.
 */
let pauseBeforeSlice: () => number = () => 0;
export function setSlicePause(pause: () => number): void {
  pauseBeforeSlice = pause;
}

/** Lets the event loop run: on the phone and Fire TV the UI shares a thread with the import. */
export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, pauseBeforeSlice())));

/** The most one slice holds the thread for: a few frames, so the remote still answers mid-import. */
const SLICE_MS = 40;

/**
 * Applies `apply` to each item in transactions of about `budget` rows, or `SLICE_MS` of work if that comes first
 * (a slow device), yielding to the event loop between them, so a large import does not hold the thread for seconds at a time. Imports only ever upsert, so a crash between
 * slices leaves valid rows and the next refresh finishes the job.
 */
export async function applyInSlices<T>(db: Database.Database, items: readonly T[], rowsIn: (item: T) => number, apply: (item: T) => void, budget = 1500): Promise<void> {
  const runSlice = db.transaction((slice: readonly T[]) => {
    for (const item of slice) apply(item);
  });
  // The rows a slice can take within its time, learned from the slices so far.
  let fits = budget;
  let slice: T[] = [];
  let rows = 0;
  for (const item of items) {
    slice.push(item);
    rows += rowsIn(item) + 1;
    if (rows >= fits) {
      const started = Date.now();
      runSlice(slice);
      const took = Date.now() - started;
      if (took > 0) fits = Math.max(100, Math.min(budget, Math.round((rows * SLICE_MS) / took)));
      slice = [];
      rows = 0;
      await yieldToEventLoop();
    }
  }
  if (slice.length > 0) runSlice(slice);
}
