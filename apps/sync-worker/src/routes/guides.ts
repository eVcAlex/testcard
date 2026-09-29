import { z } from "zod";
import { guideFileName, isSharableGuideUrl } from "@testcard/sync-schema";
import { parseJsonBody, type AppContext } from "../validation.js";

const RegisterBodySchema = z.object({ url: z.string().min(1) });

/** The most addresses the job is asked to read: each is a download of tens of megabytes. */
const MOST_GUIDES = 500;

/**
 * A signed-in device tells the Worker a guide address its sources use, so the daily job builds a small file for it.
 * Only plain public guide files are taken (see `isSharableGuideUrl`); anything else is refused, since the job fetches
 * whatever is listed. Returns the file's name, which the device then asks `/app/` for.
 */
export async function handleRegisterGuide(c: AppContext): Promise<Response> {
  const parsed = await parseJsonBody(c, RegisterBodySchema);
  if (!parsed.ok) return parsed.response;
  const { url } = parsed.data;
  if (!isSharableGuideUrl(url)) return c.json({ error: "not a public guide address" }, 400);

  const file = await guideFileName(url);
  const now = Date.now();
  const known = await c.env.DB.prepare(`UPDATE guide_sources SET last_seen = ? WHERE file = ?`).bind(now, file).run();
  if (known.meta.changes === 0) {
    const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM guide_sources`).first<{ n: number }>();
    if ((count?.n ?? 0) >= MOST_GUIDES) return c.json({ error: "too many guides registered" }, 429);
    await c.env.DB.prepare(`INSERT OR IGNORE INTO guide_sources (file, url, first_seen, last_seen) VALUES (?, ?, ?, ?)`).bind(file, url, now, now).run();
  }
  return c.json({ file });
}
