import { z } from "zod";

/**
 * An Xtream login as it exists client-side, before encryption. Never crosses the wire in this
 * shape — see `SyncSourceSchema`, which carries only its ciphertext.
 */
export const SourceCredentialsPayloadSchema = z.object({
  host: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});
export type SourceCredentialsPayload = z.infer<typeof SourceCredentialsPayloadSchema>;

/**
 * One syncable row shape, reused for every table: identified by `remoteKey` (device-independent,
 * see `packages/core/src/sync/remoteKey.ts`), timestamped for last-write-wins, and soft-deleted
 * via `deletedAt` so removals propagate instead of only additions (see design spec "Sync
 * protocol").
 */
const SyncedRowSchema = z.object({
  remoteKey: z.string().min(1),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().nullable(),
});

export const SyncSourceSchema = SyncedRowSchema.extend({
  label: z.string().min(1),
  /** AES-GCM ciphertext (base64) of a `SourceCredentialsPayload`. The server never sees plaintext. */
  credentialsBlob: z.string().min(1),
  /** AES-GCM IV (base64), one per encryption. */
  credentialsIv: z.string().min(1),
});
export type SyncSource = z.infer<typeof SyncSourceSchema>;

export const SyncFavouriteSchema = SyncedRowSchema.extend({
  addedAt: z.number().int().nonnegative(),
});
export type SyncFavourite = z.infer<typeof SyncFavouriteSchema>;

export const SyncRecentSchema = SyncedRowSchema.extend({
  playedAt: z.number().int().nonnegative(),
});
export type SyncRecent = z.infer<typeof SyncRecentSchema>;

export const SyncProgressSchema = SyncedRowSchema.extend({
  itemType: z.enum(["movie", "episode"]),
  positionSecs: z.number().int().nonnegative(),
  durationSecs: z.number().int().positive().nullable(),
  watched: z.boolean(),
});
export type SyncProgress = z.infer<typeof SyncProgressSchema>;

export const SyncPullResponseSchema = z.object({
  sources: z.array(SyncSourceSchema),
  movieFavourites: z.array(SyncFavouriteSchema),
  movieRecents: z.array(SyncRecentSchema),
  seriesFavourites: z.array(SyncFavouriteSchema),
  seriesRecents: z.array(SyncRecentSchema),
  progress: z.array(SyncProgressSchema),
  serverCursor: z.number().int().nonnegative(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

export const SyncPushRequestSchema = z.object({
  sources: z.array(SyncSourceSchema),
  movieFavourites: z.array(SyncFavouriteSchema),
  movieRecents: z.array(SyncRecentSchema),
  seriesFavourites: z.array(SyncFavouriteSchema),
  seriesRecents: z.array(SyncRecentSchema),
  progress: z.array(SyncProgressSchema),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const SyncPushResponseSchema = z.object({
  newCursor: z.number().int().nonnegative(),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;
