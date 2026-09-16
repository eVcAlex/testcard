import { SourceCredentialsPayloadSchema, type SourceCredentialsPayload } from "@testcard/sync-schema";

/**
 * Client-side AES-GCM encryption of Xtream credentials, keyed by the account password (never
 * the account password itself, and never sent anywhere) — the Worker/D1 only ever stores
 * ciphertext. See the design spec's "Credential encryption". If the account password is lost
 * with no separate recovery flow, this is intentionally unrecoverable — see the spec's stated
 * trade-off; that's what makes this real encryption rather than security theatre.
 */

export interface EncryptedPayload {
  readonly blob: string; // base64 AES-GCM ciphertext
  readonly iv: string; // base64 96-bit IV
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** A fresh per-account salt, generated once at sign-up and stored server-side (not secret). */
export function generateSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

async function deriveKey(password: string, saltBase64: string) {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromBase64(saltBase64), iterations: 210_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptCredentials(
  payload: SourceCredentialsPayload,
  password: string,
  saltBase64: string,
): Promise<EncryptedPayload> {
  const key = await deriveKey(password, saltBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(SourceCredentialsPayloadSchema.parse(payload)));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { blob: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

export async function decryptCredentials(
  encrypted: EncryptedPayload,
  password: string,
  saltBase64: string,
): Promise<SourceCredentialsPayload> {
  const key = await deriveKey(password, saltBase64);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(encrypted.iv) },
    key,
    fromBase64(encrypted.blob),
  );
  return SourceCredentialsPayloadSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
}
