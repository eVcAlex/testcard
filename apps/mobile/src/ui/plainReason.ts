/**
 * A failure in words for a person on a sofa: what the provider's or the network's error means, not a Java class
 * name. What is not recognised is passed through, tidied.
 */
export function plainReason(message: string, who = "the provider"): string {
  if (serverGone(message)) {
    const host = goneHost(message);
    return `${who[0]!.toUpperCase()}${who.slice(1)}'s server address${host !== null ? ` (${host})` : ""} no longer exists. Providers sometimes move to a new one: check the address they gave you, then change it with Edit source.`;
  }
  if (/Network request failed|unreachable|ECONNREFUSED|ConnectException/i.test(message))
    return `Couldn't reach ${who}. Its server may be down, or check the TV's internet connection.`;
  if (/did not respond|timed? ?out|ETIMEDOUT|SocketTimeout/i.test(message)) return `${who[0]!.toUpperCase()}${who.slice(1)} didn't respond.`;
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|credentials|login|password/i.test(message))
    return "The provider turned down the login. Press Edit to check it.";
  if (/\b5\d\d\b/.test(message)) return "The provider's server had a problem.";
  const tidy = message
    .replace(/^fetch failed:\s*/i, "")
    .replace(/\b(?:[a-z]+\.)+[A-Z]\w*(?:Exception|Error):\s*/g, "")
    .replace(/\s*Try again[^.]*\.?$/i, "")
    .trim();
  if (tidy === "") return "";
  const sentence = tidy[0]!.toUpperCase() + tidy.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** The provider's server name no longer resolves: usually a provider that moved to a new address, not a network fault. */
export const serverGone = (message: string) => /UnknownHost|resolve host|ENOTFOUND|No address associated/i.test(message);

/** The server name a lookup failed for, from the error. */
export function goneHost(message: string): string | null {
  return /host\s+"([^"]+)"/i.exec(message)?.[1] ?? /ENOTFOUND\s+(\S+)/.exec(message)?.[1] ?? null;
}
