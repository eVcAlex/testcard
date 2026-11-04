/**
 * A source failure in words a person can act on. The raw text is a mix of Electron's wrapper ("Error invoking remote method ..."),
 * Node's error names ("TypeError: fetch failed"), the provider's own HTTP status and the relay's note, none of which says what to do.
 * What is not recognised is passed through tidied. `who` is how the provider is named in the sentence (the source's name).
 */
export function explainFailure(raw: string, who = "the provider"): string {
  let message = raw.replace(/^Error invoking remote method '[^']*':\s*/i, "");
  while (/^(?:[A-Za-z]*Error):\s*/.test(message)) message = message.replace(/^(?:[A-Za-z]*Error):\s*/, "");

  const relay = /\s*\(relay: ([^)]*)\)\s*$/.exec(message)?.[1];
  if (relay !== undefined) message = message.replace(/\s*\(relay: [^)]*\)\s*$/, "");
  const status = /\bHTTP (\d{3})\b/.exec(message)?.[1];
  const code = status === undefined ? undefined : Number(status);

  if (/did not send a list/i.test(message)) {
    return `${who} answered, but not with a list. The account may be expired or disabled: check it with your provider.`;
  }
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|No address associated|UnknownHost/i.test(message)) {
    return `${who}'s server address no longer exists. Providers sometimes move to a new one: check the address they gave you, then change it with Edit.`;
  }
  if (code === 401 || code === 403) {
    return `${who} refused the request (HTTP ${code}). The login may have expired or been changed, or ${who} may block this network. Check the login with Edit, or try another network.`;
  }
  if (code === 404) return `${who} doesn't have that page (HTTP 404). Check the server address with Edit.`;
  if (code === 429 || /too many connections|max(imum)? connections/i.test(message)) {
    return `${who} says there are too many requests or connections. Close it on other devices, wait a few minutes and try again.`;
  }
  if (code !== undefined && code >= 500) return `${who}'s server had a problem (HTTP ${code}). Try again in a little while.`;
  if (/did not respond|timed? ?out|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(message)) {
    return `${who} didn't answer in time. Its server may be down or slow${relayClause(relay)}.`;
  }
  if (/fetch failed|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|Network request failed|socket hang up|certificate|SSL|TLS/i.test(message)) {
    return `Couldn't reach ${who}. Its server may be down, or this network may be blocking it${relayClause(relay)}.`;
  }

  const tidy = message.replace(/\s+/g, " ").trim().slice(0, 200);
  if (tidy === "") return "That didn't work. Try again.";
  const sentence = tidy[0]!.toUpperCase() + tidy.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** What the relay's own failure means, appended to a "couldn't reach" sentence. Empty when the relay was not tried (signed out). */
function relayClause(relay: string | undefined): string {
  if (relay === undefined) return ". Signing in lets Testcard try another route";
  if (/\b401\b|unauthori[sz]ed/i.test(relay)) return ". The other route (through your account) was refused: sign in again";
  if (/\b404\b|not found/i.test(relay)) return ". The other route (through your account) is switched off";
  if (/\b429\b|limit/i.test(relay)) return ". The other route (through your account) has reached its daily limit";
  if (/\b(502|504)\b|could not reach|did not respond/i.test(relay)) return ". The other route (through your account) couldn't reach it either";
  if (/\b(403|451)\b/.test(relay)) return ". The other route (through your account) was refused by the provider too";
  return `. The other route (through your account) failed too (${relay})`;
}
