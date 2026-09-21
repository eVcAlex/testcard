/**
 * Remembers expensive results per database until its `version` changes (a sync or import). For reads
 * that walk the whole catalogue, like category counts, which would otherwise repeat on every screen visit.
 * An optional key keeps one result per scope (the source being browsed).
 */
export function memoByVersion<Db extends object, T>(
  build: (db: Db, key?: string) => T,
): ((db: Db, version: number, key?: string) => T) & {
  cached: (db: Db, version: number, key?: string) => T | undefined;
  /** The newest result for this key from any version: out of date, but better on screen than a blank while the fresh one builds. */
  stale: (db: Db, key?: string) => T | undefined;
} {
  const newest = new Map<string, T>();
  let last: { db: Db; version: number; values: Map<string, T> } | undefined;
  const values = (db: Db, version: number): Map<string, T> => {
    if (last === undefined || last.db !== db || last.version !== version) last = { db, version, values: new Map() };
    return last.values;
  };
  const read = (db: Db, version: number, key?: string): T => {
    const map = values(db, version);
    const id = key ?? "";
    if (map.has(id)) return map.get(id) as T;
    const value = build(db, key);
    map.set(id, value);
    newest.set(id, value);
    return value;
  };
  // `cached` is the remembered result, or undefined when nothing has built it yet, so a screen can build after its first paint.
  return Object.assign(read, {
    cached: (db: Db, version: number, key?: string) => values(db, version).get(key ?? ""),
    stale: (_db: Db, key?: string) => newest.get(key ?? ""),
  });
}
