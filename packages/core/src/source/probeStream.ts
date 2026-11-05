/**
 * What a stream address does when fetched directly, from this machine, with the same network stack the catalogue calls use.
 * Used after the player fails on a channel to say *why* in words, without the viewer reading logs: a refusal (HTTP 403 and the
 * like), a connection that is cut or never answers (an ISP or VPN in the way), or a stream that answers fine (so the player is
 * what failed). The address carries the login, so nothing here ever puts it in a result.
 */
export type StreamProbe =
  | { readonly kind: "data"; readonly status: number; readonly bytes: number; readonly contentType: string | null }
  | { readonly kind: "refused"; readonly status: number }
  | { readonly kind: "silent"; readonly status: number }
  | { readonly kind: "unreachable"; readonly reason: "timeout" | "reset" | "refused" | "dns" | "tls" | "other" };

/**
 * How the app introduces itself to a provider's video server, for the player and for `probeStream` alike. IPTV providers (and the
 * Cloudflare rules in front of many of them) let VLC through and often turn away an unknown or generic client, which showed as
 * 403s and 5xx for streams that play fine elsewhere.
 */
export const STREAM_USER_AGENT = "VLC/3.0.21 LibVLC/3.0.21";

export interface ProbeOptions {
  readonly fetchImpl?: typeof fetch;
  /** How long the provider gets to start answering. */
  readonly responseMs?: number;
  /** How long a stream that answered gets to send its first bytes. */
  readonly dataMs?: number;
}

export async function probeStream(url: string, options: ProbeOptions = {}): Promise<StreamProbe> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const responseMs = options.responseMs ?? 8_000;
  const dataMs = options.dataMs ?? 6_000;
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), responseMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: "GET", signal: controller.signal, headers: { "user-agent": STREAM_USER_AGENT, accept: "*/*" } });
    } catch (error) {
      return { kind: "unreachable", reason: controller.signal.aborted ? "timeout" : reasonOf(error) };
    }
    clearTimeout(timer);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "refused", status: response.status };
    }
    if (response.body === null) return { kind: "silent", status: response.status };

    timer = setTimeout(() => controller.abort(), dataMs);
    const reader = response.body.getReader();
    let bytes = 0;
    try {
      // A live stream never ends: the first chunk is enough to know data is arriving.
      const { value } = await reader.read();
      bytes = value?.byteLength ?? 0;
    } catch {
      bytes = 0;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return bytes > 0
      ? { kind: "data", status: response.status, bytes, contentType: response.headers.get("content-type") }
      : { kind: "silent", status: response.status };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function reasonOf(error: unknown): "reset" | "refused" | "dns" | "tls" | "other" {
  const text = `${error instanceof Error ? error.message : ""} ${((error as { cause?: { code?: string; message?: string } } | null)?.cause?.code ?? "")} ${((error as { cause?: { message?: string } } | null)?.cause?.message ?? "")}`;
  if (/ECONNRESET|UND_ERR_SOCKET|socket hang up|other side closed|terminated/i.test(text)) return "reset";
  if (/ECONNREFUSED/i.test(text)) return "refused";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return "dns";
  if (/CERT|SSL|TLS/i.test(text)) return "tls";
  return "other";
}

/** The probe in words a viewer can act on. `who` names the provider. Never includes the address. */
export function describeStreamProbe(probe: StreamProbe, who = "the provider"): string {
  switch (probe.kind) {
    case "data":
      return `The stream itself answers from this PC (HTTP ${probe.status}, data arriving), so your network is not blocking it. It is the built-in player that cannot open it.`;
    case "refused":
      if (probe.status === 401 || probe.status === 403 || probe.status === 456 || probe.status === 458) {
        return `${who} refused the stream (HTTP ${probe.status}). Usually the login is in use on too many devices or has expired, or ${who} is blocking this connection (a VPN address, for one).`;
      }
      if (probe.status === 404) return `${who} doesn't have this channel (HTTP 404). It may have been removed: refresh the source.`;
      if (probe.status === 429) return `${who} says there are too many connections (HTTP 429). Close it on other devices and try again.`;
      return `${who} answered with an error (HTTP ${probe.status}).`;
    case "silent":
      return `${who} accepted the connection (HTTP ${probe.status}) but sent no video. The channel may be offline, or the account's connections are all in use.`;
    case "unreachable":
      switch (probe.reason) {
        case "timeout":
          return `${who}'s video server did not answer from this PC. Something on the way is dropping the connection: your ISP, or a VPN that does not cover this.`;
        case "reset":
          return `The connection to ${who}'s video server was cut off. That is typical of an ISP block, or of a VPN address the provider turns away.`;
        case "refused":
          return `${who}'s video server refused the connection. Its port may be closed or blocked on this network.`;
        case "dns":
          return `This PC cannot find ${who}'s video server by name. Its address may have changed, or DNS is blocking it.`;
        case "tls":
          return `The secure connection to ${who}'s video server failed.`;
        default:
          return `This PC could not connect to ${who}'s video server.`;
      }
  }
}
