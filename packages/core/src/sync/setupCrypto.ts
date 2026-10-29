import { SetupProfilePayloadSchema, fromBase64Url, setupClaimHash, toBase64Url, type SetupProfilePayload } from "@testcard/sync-schema";

/**
 * Sealing a source for a setup link. The link is `https://evicted.dev/s#<id>.<secret>`; the secret is 256 random bits and
 * lives only in the fragment, which browsers never send to a server. Two keys come from it with HKDF:
 *  - a *proof* the receiving device shows the Worker to be handed the ciphertext (the Worker keeps only its hash), and
 *  - the AES-GCM key that seals the source, bound to the profile's id so a blob cannot be moved to another profile.
 * The Worker therefore holds ciphertext it cannot open, and does not hand it to anyone who only knows the id.
 *
 * The secret is a bearer credential: whoever holds the link can claim the profile until it is used up, expires or is revoked.
 */
const CLAIM_INFO = "testcard-setup-claim-v1";
const SEAL_INFO = "testcard-setup-seal-v1";

export interface SetupLink {
  readonly id: string;
  readonly secret: string;
}

/** A fresh profile id and secret. */
export function generateSetupLink(): SetupLink {
  return { id: toBase64Url(crypto.getRandomValues(new Uint8Array(16))), secret: toBase64Url(crypto.getRandomValues(new Uint8Array(32))) };
}

/** What follows `#` in the link. */
export function formatSetupFragment(link: SetupLink): string {
  return `${link.id}.${link.secret}`;
}

/** Reads what followed `#`; null when it is not a link of ours. */
export function parseSetupFragment(fragment: string): SetupLink | null {
  const match = /^#?([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(fragment.trim());
  return match === null ? null : { id: match[1]!, secret: match[2]! };
}

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

async function hkdf(secret: string): Promise<Key> {
  return crypto.subtle.importKey("raw", fromBase64Url(secret), "HKDF", false, ["deriveBits", "deriveKey"]);
}

const params = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(info) });

/** The proof the Worker asks for, and the hash of it that the sender registers. */
export async function setupProof(secret: string): Promise<{ readonly proof: string; readonly claimHash: string }> {
  const bits = await crypto.subtle.deriveBits(params(CLAIM_INFO), await hkdf(secret), 256);
  const proof = toBase64Url(new Uint8Array(bits));
  return { proof, claimHash: await setupClaimHash(proof) };
}

async function sealKey(secret: string, usage: "encrypt" | "decrypt"): Promise<Key> {
  return crypto.subtle.deriveKey(params(SEAL_INFO), await hkdf(secret), { name: "AES-GCM", length: 256 }, false, [usage]);
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/** Validates, then seals, the source to share. Throws if the payload is not an acceptable setup profile. */
export async function sealSetupProfile(payload: SetupProfilePayload, link: SetupLink): Promise<{ blob: string; iv: string }> {
  const checked = SetupProfilePayloadSchema.parse(payload);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(link.id) },
    await sealKey(link.secret, "encrypt"),
    new TextEncoder().encode(JSON.stringify(checked)),
  );
  return { blob: toBase64(new Uint8Array(sealed)), iv: toBase64(iv) };
}

/**
 * Opens what the Worker returned and validates it again: what arrives is never trusted just because it decrypted.
 * Throws if the secret is wrong, the blob was altered or moved to another id, or the contents are not a setup profile.
 */
export async function openSetupProfile(sealed: { blob: string; iv: string }, link: SetupLink): Promise<SetupProfilePayload> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv), additionalData: new TextEncoder().encode(link.id) },
    await sealKey(link.secret, "decrypt"),
    fromBase64(sealed.blob),
  );
  return SetupProfilePayloadSchema.parse(JSON.parse(new TextDecoder().decode(plain)));
}
