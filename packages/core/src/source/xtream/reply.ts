/**
 * A list a panel answered (`get_vod_streams`, `get_series_categories`, ...): the array it asked for, or `[]` when the panel says
 * "nothing here" with `{}`. Any other answer is not usable, and is said in words a person can act on, with the provider's own words
 * when it gave some. It is never read as an empty list: an import that took an error for "no channels" would drop what the app has.
 * `what` completes "...for its movies".
 */
export function asReplyList<T>(reply: unknown, what: string): T[] {
  if (Array.isArray(reply)) return reply as T[];
  if (typeof reply === "object" && reply !== null) {
    const record = reply as Record<string, unknown>;
    if (Object.keys(record).length === 0) return [];
    const auth = (record["user_info"] as { auth?: unknown } | null | undefined)?.auth;
    if (auth === 0 || auth === "0" || auth === false) throw new Error("The provider rejected the login.");
    const said = ["message", "error", "msg", "status", "reason"]
      .map((key) => record[key])
      .find((value): value is string => typeof value === "string" && value.trim() !== "");
    throw new Error(`The provider sent a reply the app couldn't read for ${what}${said !== undefined ? `. It said: "${said.trim().slice(0, 100)}"` : ""}.`);
  }
  throw new Error(`The provider sent a reply the app couldn't read for ${what}.`);
}
