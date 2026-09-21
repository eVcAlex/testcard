/**
 * The crypto for signing a TV in with a code. The TV shows a short code; the person types it, with their email and
 * password, on a phone or computer; the page seals `{ email, password }` under a key made from the code and the TV
 * unseals it. The server only ever sees a lookup value and the sealed blob, so it cannot read the password.
 *
 * The web page (apps/sync-worker/src/pages/linkPage.ts) repeats these steps in plain browser JavaScript. The
 * constants here are the contract; a test holds the page to them.
 */
export const LINK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;
export const LINK_LOOKUP_SALT = "testcard-link-lookup-v1";
export const LINK_ITERATIONS = 210_000;

export interface LinkSecrets {
  readonly email: string;
  readonly password: string;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** A fresh code: 8 characters from an alphabet without look-alikes (40 bits). */
export function generateLinkCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LINK_CODE_LENGTH));
  // 256 is a multiple of the alphabet's 32 characters, so taking the remainder is not biased.
  return Array.from(bytes, (byte) => LINK_ALPHABET[byte % LINK_ALPHABET.length]).join("");
}

/** Upper case, without spaces or dashes: what was typed, ready to use. */
export function normaliseLinkCode(typed: string): string {
  return typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidLinkCode(code: string): boolean {
  return code.length === LINK_CODE_LENGTH && [...code].every((char) => LINK_ALPHABET.includes(char));
}

/** "K7M4-QX2P": how the code is shown. */
export function formatLinkCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function generateLinkSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

async function base(code: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits", "deriveKey"]);
}

/** What the server files the session under. Slow to compute on purpose, so guessing codes from it is not practical. */
export async function deriveLinkLookup(code: string): Promise<string> {
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(LINK_LOOKUP_SALT), iterations: LINK_ITERATIONS, hash: "SHA-256" }, await base(code), 256);
  return toBase64(new Uint8Array(bits));
}

async function deriveKey(code: string, saltBase64: string, usage: "encrypt" | "decrypt") {
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromBase64(saltBase64), iterations: LINK_ITERATIONS, hash: "SHA-256" }, await base(code), { name: "AES-GCM", length: 256 }, false, [usage]);
}

/** Seals the person's email and password so only the holder of the code can read them. */
export async function sealLinkSecrets(secrets: LinkSecrets, code: string, saltBase64: string): Promise<{ blob: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveKey(code, saltBase64, "encrypt"), new TextEncoder().encode(JSON.stringify(secrets)));
  return { blob: toBase64(new Uint8Array(sealed)), iv: toBase64(iv) };
}

/** Opens what the page sealed. Throws if the code is wrong or the blob was altered. */
export async function openLinkSecrets(sealed: { blob: string; iv: string }, code: string, saltBase64: string): Promise<LinkSecrets> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(sealed.iv) }, await deriveKey(code, saltBase64, "decrypt"), fromBase64(sealed.blob));
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<LinkSecrets>;
  if (typeof parsed.email !== "string" || typeof parsed.password !== "string") throw new Error("The link did not carry a sign-in.");
  return { email: parsed.email, password: parsed.password };
}
