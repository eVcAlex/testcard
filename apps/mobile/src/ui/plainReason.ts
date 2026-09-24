/**
 * A failure in words for a person on a sofa: what the provider's or the network's error means, not a Java class
 * name. What is not recognised is passed through, tidied.
 */
export function plainReason(message: string, who = "the provider"): string {
  if (/UnknownHost|resolve host|ENOTFOUND|No address associated|Network request failed|unreachable|ECONNREFUSED|ConnectException/i.test(message))
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
