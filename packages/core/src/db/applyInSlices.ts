import type Database from "better-sqlite3";

/** Lets the event loop run: on the phone and Fire TV the UI shares a thread with the import. */
export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Applies `apply` to each item in transactions of about `budget` rows, yielding to the event loop between them,
 * so a large import does not hold the thread for seconds at a time. Imports only ever upsert, so a crash between
 * slices leaves valid rows and the next refresh finishes the job.
 */
export async function applyInSlices<T>(db: Database.Database, items: readonly T[], rowsIn: (item: T) => number, apply: (item: T) => void, budget = 1500): Promise<void> {
  const runSlice = db.transaction((slice: readonly T[]) => {
    for (const item of slice) apply(item);
  });
  let slice: T[] = [];
  let rows = 0;
  for (const item of items) {
    slice.push(item);
    rows += rowsIn(item) + 1;
    if (rows >= budget) {
      runSlice(slice);
      slice = [];
      rows = 0;
      await yieldToEventLoop();
    }
  }
  if (slice.length > 0) runSlice(slice);
}
