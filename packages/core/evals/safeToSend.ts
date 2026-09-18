/**
 * The audit harness only ever sends a provider *category name* to TypeSafe. Category names are
 * short human labels ("UK| SKY SPORTS"), but they come from a third party's data, so this refuses
 * anything that looks like it could carry a URL, credential or token instead. A refused name is
 * skipped (and counted in the report), never sent.
 */
const UNSAFE = [
  /:\/\//, //                          any URL scheme
  /\bwww\./i, //                       a bare hostname
  /@/, //                              an email or user@host
  /(?:password|passwd|username|user|token|secret|apikey|api_key|key)\s*[=:]/i, // key=value credentials
  /[?&][a-z_]+=[^&\s]{6,}/i, //        a query string
  /\b[a-f0-9]{24,}\b/i, //             a long hex token
  /\b[A-Za-z0-9+/_-]{32,}\b/, //       a long opaque token
];

export const MAX_NAME_LENGTH = 120;

export function isSafeToSend(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return false;
  return !UNSAFE.some((pattern) => pattern.test(name));
}
