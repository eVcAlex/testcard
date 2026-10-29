import { z } from "zod";

/**
 * A prepared source shared by link ("setup profile"). The payload below is sealed on the sender's device under a secret
 * that only ever travels in the link's fragment, so the server stores ciphertext it cannot open. It carries one source and
 * nothing of the sender's account: no session, no account password, no history.
 *
 * The wire shapes are here so the Worker, the apps and the web page agree on them.
 */

const httpUrl = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an http or https address");

const SetupContentSchema = z.object({ live: z.boolean(), movies: z.boolean(), series: z.boolean() }).strict();

/** An Xtream login. */
export const SetupXtreamSourceSchema = z
  .object({
    host: httpUrl,
    username: z.string().min(1).max(256),
    password: z.string().min(1).max(256),
    backupHosts: z.array(httpUrl).max(10).optional(),
    epgUrl: httpUrl.optional(),
    content: SetupContentSchema.optional(),
  })
  .strict();

/** A playlist address (which may carry a login in its query string, so is as sensitive as a login). */
export const SetupPlaylistSourceSchema = z
  .object({
    playlistUrl: httpUrl,
    epgUrl: httpUrl.optional(),
    content: SetupContentSchema.optional(),
  })
  .strict();

/**
 * What is sealed. Strict on purpose: pins, hidden items, history and the like are the sender's own and are not shared,
 * and an unknown field is refused rather than carried along.
 */
export const SetupProfilePayloadSchema = z
  .object({
    v: z.literal(1),
    /** How the source is named on the receiving device. */
    name: z.string().trim().min(1).max(60),
    /** Turn on guide matching by name for the source. */
    epgOptimise: z.boolean().optional(),
    source: z.union([SetupXtreamSourceSchema, SetupPlaylistSourceSchema]),
  })
  .strict();
export type SetupProfilePayload = z.infer<typeof SetupProfilePayloadSchema>;

const base64Url = (length: number) => z.string().length(length).regex(/^[A-Za-z0-9_-]+$/);

/** 16 random bytes. Public: it names the profile, and opens nothing on its own. */
export const SetupIdSchema = base64Url(22);
/** 32 bytes derived from the link's secret; proves the holder has the link. Never stored. */
export const SetupProofSchema = base64Url(43);
/** SHA-256 of the proof: what the server keeps to check a claim against. */
export const SetupClaimHashSchema = base64Url(43);

export const SETUP_DEFAULT_DAYS = 7;
export const SETUP_MAX_DAYS = 30;
export const SETUP_MAX_CLAIMS = 5;
export const SETUP_MAX_ACTIVE_PER_ACCOUNT = 25;

export const SetupCreateRequestSchema = z.object({
  id: SetupIdSchema,
  claimHash: SetupClaimHashSchema,
  /** The sender's own note ("Mum's TV"). Plain text, shown only to the sender. */
  label: z.string().trim().min(1).max(60),
  blob: z.string().min(16).max(8192).regex(/^[A-Za-z0-9+/=]+$/),
  iv: z.string().min(12).max(24).regex(/^[A-Za-z0-9+/=]+$/),
  expiresInDays: z.number().int().min(1).max(SETUP_MAX_DAYS).default(SETUP_DEFAULT_DAYS),
  maxClaims: z.number().int().min(1).max(SETUP_MAX_CLAIMS).default(1),
});
export type SetupCreateRequest = z.infer<typeof SetupCreateRequestSchema>;

export const SetupClaimRequestSchema = z.object({ id: SetupIdSchema, proof: SetupProofSchema });

/** One of the sender's profiles as listed to them: no ciphertext. */
export const SetupProfileSummarySchema = z.object({
  id: SetupIdSchema,
  label: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  maxClaims: z.number(),
  claims: z.number(),
  revokedAt: z.number().nullable(),
});
export type SetupProfileSummary = z.infer<typeof SetupProfileSummarySchema>;

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** What the server keeps in place of the proof. */
export async function setupClaimHash(proof: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", fromBase64Url(proof))));
}
