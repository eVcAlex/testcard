import { z } from "zod";

/**
 * A source's secret as it exists client-side, before encryption: an Xtream login, or an M3U
 * playlist URL (which routinely embeds a username/password in its query string, so it is as
 * sensitive as a login). Never crosses the wire in this shape — see `SyncSourceSchema`, which
 * carries only its ciphertext. The two shapes are told apart by which keys they have.
 */
/**
 * Which kinds of content a source loads on this account's devices. Optional: an older device leaves it out
 * (and ignores it), and a device that gets none keeps what it has.
 */
export const SourceContentSchema = z.object({ live: z.boolean(), movies: z.boolean(), series: z.boolean() });
export type SourceContent = z.infer<typeof SourceContentSchema>;
/**
 * A category pinned to the Home page. It rides inside the source's encrypted record, so the server learns nothing
 * about what is pinned and needs no table for it. Optional: an older device leaves it out (and ignores it).
 * `key` is the category's provider id, which every device shares for a given source.
 */
export const SourcePinSchema = z.object({ kind: z.enum(["live", "movies", "series"]), key: z.string().min(1), label: z.string().min(1) });
export type SourcePin = z.infer<typeof SourcePinSchema>;
export const XtreamCredentialsPayloadSchema = z.object({
  host: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  content: SourceContentSchema.optional(),
  position: z.number().int().optional(),
  pins: z.array(SourcePinSchema).optional(),
});
export const PlaylistPayloadSchema = z.object({
  playlistUrl: z.string().min(1),
  content: SourceContentSchema.optional(),
  position: z.number().int().optional(),
  pins: z.array(SourcePinSchema).optional(),
});
export const SourceCredentialsPayloadSchema = z.union([XtreamCredentialsPayloadSchema, PlaylistPayloadSchema]);
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

/**
 * A source's payload fields are nullable so a *tombstone* (`deletedAt` set) can be represented
 * without still carrying the credentials it is deleting — a device that removes a source should be
 * able to forget its credentials, not be forced to keep re-uploading the ciphertext forever. The
 * refine below keeps the two valid states honest: live rows carry all three, tombstones may carry
 * none; a half-populated row (blob without iv, say) is rejected.
 */
export const SyncSourceSchema = SyncedRowSchema.extend({
  label: z.string().min(1).nullable(),
  /** AES-GCM ciphertext (base64) of a `SourceCredentialsPayload`. The server never sees plaintext. */
  credentialsBlob: z.string().min(1).nullable(),
  /** AES-GCM IV (base64), one per encryption. */
  credentialsIv: z.string().min(1).nullable(),
}).refine(
  (row) => {
    const allNull = row.label === null && row.credentialsBlob === null && row.credentialsIv === null;
    const allPresent = row.label !== null && row.credentialsBlob !== null && row.credentialsIv !== null;
    return row.deletedAt === null ? allPresent : allNull || allPresent;
  },
  {
    message:
      "label, credentialsBlob and credentialsIv must all be present on a live source, and may only all be null together on a tombstone (deletedAt set)",
    path: ["credentialsBlob"],
  },
);
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
