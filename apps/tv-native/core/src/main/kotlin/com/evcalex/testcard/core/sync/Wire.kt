package com.evcalex.testcard.core.sync

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The wire shapes of `packages/sync-schema`. Every field TS writes as `null` is written as `null` here
 * (`explicitNulls`); anything the TS leaves out is a defaulted optional that is not encoded.
 */
@Serializable
data class WireSource(
    val remoteKey: String,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    val label: String? = null,
    val credentialsBlob: String? = null,
    val credentialsIv: String? = null,
)

@Serializable
data class WireFavourite(val remoteKey: String, val updatedAt: Long, val deletedAt: Long? = null, val addedAt: Long)

@Serializable
data class WireRecent(val remoteKey: String, val updatedAt: Long, val deletedAt: Long? = null, val playedAt: Long)

@Serializable
data class WireChannelFavourite(val remoteKey: String, val updatedAt: Long, val deletedAt: Long? = null, val addedAt: Long, val position: Int? = null)

@Serializable
data class WireProgress(
    val remoteKey: String,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    val itemType: String,
    val positionSecs: Long,
    val durationSecs: Long? = null,
    val watched: Boolean,
)

@Serializable
data class WireProfile(val remoteKey: String, val updatedAt: Long, val deletedAt: Long? = null, val blob: String? = null, val iv: String? = null)

@Serializable
data class PullResponse(
    val sources: List<WireSource> = emptyList(),
    val movieFavourites: List<WireFavourite> = emptyList(),
    val movieRecents: List<WireRecent> = emptyList(),
    val seriesFavourites: List<WireFavourite> = emptyList(),
    val seriesRecents: List<WireRecent> = emptyList(),
    val progress: List<WireProgress> = emptyList(),
    val profiles: List<WireProfile> = emptyList(),
    val channelFavourites: List<WireChannelFavourite> = emptyList(),
    val channelRecents: List<WireRecent> = emptyList(),
    val serverCursor: Long,
) {
    /** Whether anything came that this device did not have: screens re-read their data on that. */
    val count get() = sources.size + movieFavourites.size + movieRecents.size + seriesFavourites.size + seriesRecents.size + progress.size + profiles.size + channelFavourites.size + channelRecents.size
}

@Serializable
data class PushRequest(
    val sources: List<WireSource>,
    val movieFavourites: List<WireFavourite>,
    val movieRecents: List<WireRecent>,
    val seriesFavourites: List<WireFavourite>,
    val seriesRecents: List<WireRecent>,
    val progress: List<WireProgress>,
    val profiles: List<WireProfile>,
    val channelFavourites: List<WireChannelFavourite>,
    val channelRecents: List<WireRecent>,
) {
    /** The `deletedAt` of every row that is a removal: what `clearTombstones` may clear once a push succeeded. */
    val newestDeletion: Long
        get() = maxOf(
            0L,
            *(sources.mapNotNull { it.deletedAt } + movieFavourites.mapNotNull { it.deletedAt } + movieRecents.mapNotNull { it.deletedAt } +
                seriesFavourites.mapNotNull { it.deletedAt } + seriesRecents.mapNotNull { it.deletedAt } + progress.mapNotNull { it.deletedAt }).toLongArray(),
        )
}

@Serializable
data class PushResponse(val newCursor: Long)

@OptIn(ExperimentalSerializationApi::class)
internal val wireJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = true
    encodeDefaults = true
}

/** Row validation the zod schemas do, for what a pull hands us: `min(1)` keys, a live source with all three parts. */
fun WireSource.isLiveWithAllParts(): Boolean = deletedAt == null && !label.isNullOrEmpty() && !credentialsBlob.isNullOrEmpty() && !credentialsIv.isNullOrEmpty()
