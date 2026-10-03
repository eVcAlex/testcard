package com.evcalex.testcard.tv

import com.evcalex.testcard.core.db.MAIN_PROFILE
import com.evcalex.testcard.core.db.PROFILE_META_KEYS
import com.evcalex.testcard.core.db.Profile
import com.evcalex.testcard.core.db.deleteProfile
import com.evcalex.testcard.core.db.forgetProfile
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.readActiveProfile
import com.evcalex.testcard.core.db.saveProfile
import com.evcalex.testcard.core.db.swapProfile
import com.evcalex.testcard.core.db.writeActiveProfile
import com.evcalex.testcard.core.playback.readAudioLanguage
import com.evcalex.testcard.core.playback.readCaptionPrefs
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

fun AppController.saveProfile(next: Profile) {
    scope.launch {
        db.write { it.saveProfile(next) }
        sync.notifyLocalChange()
        bump()
    }
}

fun AppController.deleteProfile(id: String) {
    scope.launch {
        if (id == MAIN_PROFILE || id == profileId) return@launch
        db.write { it.deleteProfile(id) }
        sync.notifyLocalChange()
        bump()
    }
}

/** Swaps in another profile's rows; from then on sync pushes and pulls theirs. */
suspend fun AppController.switchProfile(id: String) {
    val from = db.write { it.readActiveProfile() }
    if (from == id) return
    // What the one leaving did is pushed first (briefly: a slow network only delays it to their next turn).
    withTimeoutOrNull(3000) { try { sync.triggerNow() } catch (_: Exception) { } }
    // Nothing may sync mid-swap.
    sync.setPaused(true)
    db.write { c ->
        c.swapProfile(from, id, PROFILE_META_KEYS)
        c.writeActiveProfile(id)
    }
    sync.setProfile(id)
    profileId = id
    captions = db.read { it.readCaptionPrefs() }
    audioLanguage = db.read { it.readAudioLanguage() }
    bump()
    // Resuming syncs at once, fetching the new profile's history from the account. Waited for (as at launch, up to a cap), so
    // the picker keeps saying it is switching and the screens read the history the moment it is in, not on a later tick.
    syncing = true
    try {
        sync.setPaused(false)
        withTimeoutOrNull(LAUNCH_SYNC_WAIT_MS) { try { sync.triggerNow() } catch (_: Exception) { } }
    } finally {
        status = sync.status.value
        syncing = false
    }
    bump()
}

/** The profile watching here was deleted on another TV: back to the account's own. */
suspend fun AppController.leaveDeletedProfile() {
    if (profiles.isEmpty() || profiles.any { it.id == profileId }) return
    val gone = profileId
    switchProfile(MAIN_PROFILE)
    db.write { it.forgetProfile(gone) }
}
