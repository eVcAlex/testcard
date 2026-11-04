/**
 * An Xtream list call (`get_live_categories`, `get_vod_streams` ...) answers a JSON array. A provider that is unhappy with the
 * account (expired, disabled, too many connections) or that has nothing for a category often answers something else instead,
 * an object like `{"user_info":{"auth":0}}`, `false` or `null`, and mapping that blew up as "x.map is not a function".
 * This says what came back, by shape only (keys, never values: the reply can echo the login), so the screen can show it.
 */
export function asList<T>(value: unknown, action: string): T[] {
  if (Array.isArray(value)) return value as T[];
  throw new Error(`Xtream ${action}: the provider did not send a list (${describeShape(value)}). The account may be expired or disabled.`);
}

function describeShape(value: unknown): string {
  if (value === null || value === undefined) return "it sent nothing";
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 6);
    return keys.length === 0 ? "it sent an empty object" : `it sent an object with ${keys.join(", ")}`;
  }
  return `it sent ${typeof value} ${String(value).slice(0, 20)}`;
}
