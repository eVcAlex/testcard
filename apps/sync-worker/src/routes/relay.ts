import type { AppContext } from "../validation.js";
import { follow, UPSTREAM_USER_AGENT } from "./watch.js";
import { addUsage, capBytes, counted, usedToday } from "./watchUsage.js";

/**
 * `GET /relay/list?u=<address>`: fetches a provider's playlist or guide for an app whose own network blocks the provider. The
 * app tries the provider directly first and comes here only when that fails, so a viewer the provider does not block never uses it.
 *
 * It is for lists, not video: an answer that says it is video is turned away, and a body larger than `MAX_LIST_BYTES` is cut off
 * with an error. Nothing is stored or logged here; the address carries the provider login, so it is never put in a message either.
 * Same rules as the stream proxy otherwise: a signed-in account, no private or own addresses, every redirect checked, the
 * caller's cookies never forwarded, and the same daily allowance. Answers 404 unless `LIST_RELAY` is "on".
 */

/** A big VOD catalogue is tens of megabytes of M3U; this leaves room for the largest while keeping a runaway fetch bounded. */
export const MAX_LIST_BYTES = 200 * 1024 * 1024;

/** Passes a body through, failing the stream (so the caller sees a cut-off, not a short file that looks whole) once it passes `max` bytes. */
export function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let total = 0;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        total += value.byteLength;
        if (total > max) {
          await reader.cancel();
          return controller.error(new Error("list too large"));
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

export async function handleRelayList(c: AppContext): Promise<Response> {
  if (c.env.LIST_RELAY !== "on") return c.json({ error: "not found" }, 404);

  let target: URL;
  try {
    target = new URL(c.req.query("u") ?? "");
  } catch {
    return c.json({ error: "u is not an address" }, 400);
  }

  const cap = capBytes(c.env.WATCH_DAILY_CAP_MB);
  const userId = c.get("userId");
  if (cap > 0 && (await usedToday(c.env.DB, userId)) >= cap) return c.json({ error: "daily limit reached" }, 429);

  let result: Awaited<ReturnType<typeof follow>>;
  try {
    result = await follow(target, new Headers({ "user-agent": UPSTREAM_USER_AGENT }), c.env.WATCH_ALLOW_PRIVATE === "1");
  } catch (error) {
    return c.json({ error: "could not reach the provider", detail: error instanceof Error ? error.message : String(error), host: target.host }, 502);
  }
  if ("refused" in result) return c.json({ error: result.refused }, 400);

  const { response } = result;
  const type = response.headers.get("content-type") ?? "";
  // `audio/x-mpegurl` is how providers label an M3U, so it is the one audio type that must get through.
  if (/^(video\/|audio\/(?!(x-)?mpegurl))/i.test(type)) {
    await response.body?.cancel();
    return c.json({ error: "that is a video or audio stream, not a list", host: target.host }, 415);
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_LIST_BYTES) {
    await response.body?.cancel();
    return c.json({ error: "list too large", host: target.host }, 413);
  }

  // Not content-length or content-encoding: the runtime has already decoded a compressed body, so either would now describe bytes that are gone.
  const headers = new Headers({ "cache-control": "no-store" });
  const contentType = response.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  let body = response.body === null ? null : capped(response.body, MAX_LIST_BYTES);
  if (cap > 0 && body !== null) body = counted(body, (bytes) => c.executionCtx.waitUntil(addUsage(c.env.DB, userId, bytes)));
  // The provider's own status goes through (a 403 from it is information for the app), with its body.
  return new Response(body, { status: response.status, headers });
}
