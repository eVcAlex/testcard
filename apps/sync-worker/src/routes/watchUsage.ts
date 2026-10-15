/**
 * A daily allowance of proxied bytes per account (`WATCH_DAILY_CAP_MB`; unset or 0 means no cap). The count is made as the
 * body streams past and written when it ends, so one long stream can overshoot the day's cap; the next request is turned away.
 */

const MB = 1024 * 1024;

export const capBytes = (setting: string | undefined): number => {
  const mb = Number(setting);
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * MB) : 0;
};

export const today = (now: number = Date.now()): string => new Date(now).toISOString().slice(0, 10);

export async function usedToday(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare(`SELECT bytes FROM watch_usage WHERE user_id = ? AND day = ?`).bind(userId, today()).first<{ bytes: number }>();
  return row?.bytes ?? 0;
}

export function addUsage(db: D1Database, userId: string, bytes: number): Promise<unknown> {
  if (bytes <= 0) return Promise.resolve();
  return db
    .prepare(`INSERT INTO watch_usage (user_id, day, bytes) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET bytes = bytes + excluded.bytes`)
    .bind(userId, today(), bytes)
    .run();
}

/** Passes a body through unchanged, telling `done` how many bytes went by once it finishes or the viewer goes away. */
export function counted(body: ReadableStream<Uint8Array>, done: (bytes: number) => void): ReadableStream<Uint8Array> {
  let total = 0;
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    done(total);
  };
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: finished, value } = await reader.read();
        if (finished) {
          report();
          controller.close();
          return;
        }
        total += value.byteLength;
        controller.enqueue(value);
      } catch (error) {
        report();
        controller.error(error);
      }
    },
    async cancel(reason) {
      report();
      await reader.cancel(reason);
    },
  });
}
