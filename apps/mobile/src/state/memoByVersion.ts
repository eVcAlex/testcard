/**
 * Remembers one expensive result per database until its `version` changes (a sync or import). For reads
 * that walk the whole catalogue, like category counts, which would otherwise repeat on every screen visit.
 */
export function memoByVersion<Db extends object, T>(build: (db: Db) => T): (db: Db, version: number) => T {
  let last: { db: Db; version: number; value: T } | undefined;
  return (db, version) => {
    if (last !== undefined && last.db === db && last.version === version) return last.value;
    const value = build(db);
    last = { db, version, value };
    return value;
  };
}
