package com.evcalex.testcard.tv.ui.profiles

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.db.AVATARS
import com.evcalex.testcard.core.db.MAIN_PROFILE
import com.evcalex.testcard.core.db.PROFILE_COLOURS
import com.evcalex.testcard.core.db.Profile
import com.evcalex.testcard.core.db.newProfileId
import com.evcalex.testcard.core.db.nextColour
import com.evcalex.testcard.core.db.pinHash
import com.evcalex.testcard.core.db.pinMatches
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.deleteProfile
import com.evcalex.testcard.tv.saveProfile
import com.evcalex.testcard.tv.switchProfile
import com.evcalex.testcard.tv.ui.components.AppButton
import com.evcalex.testcard.tv.ui.components.AppField
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.AvatarDisc
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.GlyphIcon
import com.evcalex.testcard.tv.ui.components.Modal
import com.evcalex.testcard.tv.ui.components.OptionsSheet
import com.evcalex.testcard.tv.ui.components.PinPad
import com.evcalex.testcard.tv.ui.components.SheetOption
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.launch

/** As many as Settings allows. */
private const val MAX_PROFILES = 6

private fun parseColour(hex: String) = Color(android.graphics.Color.parseColor(hex))

/**
 * "Who's watching?": the profiles side by side, opened on launch when there is more than one, and from the profile button in
 * the nav bar. A profile with a PIN asks for it first. `onCancel` is there when someone is already watching (opened from the
 * nav bar): Back returns to them. On launch Back leaves the app.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WhoIsWatching(app: AppController, onDone: () -> Unit, onCancel: (() -> Unit)?, onExit: () -> Unit) {
    val profiles = app.profiles
    val current = app.profile
    var asking by remember { mutableStateOf<Profile?>(null) }
    var switching by remember { mutableStateOf<Profile?>(null) }
    // Adding or changing profiles from here, before anyone is chosen: "add" opens straight on a new one's name.
    var managing by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val start = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { start.requestFocus() } }
    BackHandler(enabled = managing == null && asking == null) { if (onCancel != null) onCancel() else onExit() }

    fun open(profile: Profile) {
        if (switching != null) return
        switching = profile
        scope.launch {
            try { app.switchProfile(profile.id) } finally { onDone() }
        }
    }
    fun pick(profile: Profile) {
        // Coming back to whoever is already in needs no PIN: they never left.
        if (profile.pin != null && !(onCancel != null && profile.id == current.id)) asking = profile else open(profile)
    }

    Column(Modifier.fillMaxSize().background(Palette.background), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(64.dp, Alignment.CenterVertically)) {
        AppText("Who's watching?", 56, Palette.foreground, FontWeight.SemiBold, letterSpacing = -0.5f)
        FlowRow(Modifier.widthIn(max = 1600.dp), horizontalArrangement = Arrangement.spacedBy(36.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(36.dp)) {
            for (profile in profiles) {
                Focusable({ pick(profile) }, Modifier.width(240.dp), RoundedCornerShape(16.dp), focusRequester = if (profile.id == current.id) start else null, ring = false) { focused ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp).scale(if (focused) 1.08f else 1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
                        Box(Modifier.border(4.dp, if (focused) Palette.foreground else Color.Transparent, CircleShape).padding(6.dp)) { AvatarDisc(profile, 176.dp) }
                        AppText(profile.name, 28, if (focused) Palette.foreground else Palette.muted, FontWeight.Medium, maxLines = 1)
                    }
                }
            }
            if (profiles.size < MAX_PROFILES) {
                Focusable({ managing = "add" }, Modifier.width(240.dp), RoundedCornerShape(16.dp), ring = false) { focused ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp).scale(if (focused) 1.08f else 1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
                        Box(Modifier.border(4.dp, if (focused) Palette.foreground else Color.Transparent, CircleShape).padding(6.dp)) {
                            Box(Modifier.size(176.dp).border(3.dp, Palette.border, CircleShape), contentAlignment = Alignment.Center) {
                                GlyphIcon(Glyph.Plus, if (focused) Palette.foreground else Palette.muted, 72.dp)
                            }
                        }
                        AppText("Add profile", 28, if (focused) Palette.foreground else Palette.muted, FontWeight.Medium, maxLines = 1)
                    }
                }
            }
        }
        val switchingTo = switching
        if (switchingTo != null) AppText("Switching to ${switchingTo.name}...", 26, Palette.muted, modifier = Modifier.height(72.dp)) else AppButton("Manage profiles", { managing = "edit" })
    }
    managing?.let { mode ->
        Modal({ managing = null }) {
            Column(Modifier.fillMaxSize().background(Palette.background).padding(start = 120.dp, end = 120.dp, top = 60.dp)) {
                Box(Modifier.weight(1f)) { ProfileSettings(app, startAdding = mode == "add") }
                Row(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalArrangement = Arrangement.End) { AppButton("Done", { managing = null }, primary = true) }
            }
        }
    }
    asking?.let { profile ->
        PinPad("Enter ${profile.name}'s PIN", { digits ->
            if (!pinMatches(profile, digits)) false else { asking = null; open(profile); true }
        }, { asking = null })
    }
}

private sealed interface Pad {
    /** The profile's PIN, before anything about a locked profile is changed. */
    class Check(val profile: Profile, val next: String) : Pad

    class Choose(val profile: Profile, val first: String? = null, val mismatch: Boolean = false) : Pad
}

/**
 * The Profiles pane in Settings: who watches. Profiles are the account's, so they are on every TV signed in to it. OK on a
 * profile offers what can be done to it; a locked one asks for its PIN first.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProfileSettings(app: AppController, startAdding: Boolean = false) {
    val profiles = app.profiles
    val current = app.profile
    var sheet by remember { mutableStateOf<Profile?>(null) }
    var pad by remember { mutableStateOf<Pad?>(null) }
    // A name being typed: for a new profile (no profile) or a rename.
    var naming by remember { mutableStateOf<Pair<Profile?, String>?>(if (startAdding) null to "" else null) }
    var deleting by remember { mutableStateOf<Profile?>(null) }
    // The profile whose avatar is being chosen, by id: it is read from the list, so the picker shows each change.
    var dressing by remember { mutableStateOf<String?>(null) }
    val dressed = profiles.firstOrNull { it.id == dressing }

    fun update(id: String, change: (Profile) -> Profile) {
        val profile = profiles.firstOrNull { it.id == id } ?: return
        app.saveProfile(change(profile))
    }
    fun act(profile: Profile, action: String) {
        when (action) {
            "rename" -> naming = profile to profile.name
            "avatar" -> dressing = profile.id
            "pin" -> pad = Pad.Choose(profile)
            "unpin" -> update(profile.id) { Profile(it.id, it.name, it.colour, it.avatar, null, it.position) }
            else -> deleting = profile
        }
    }
    fun choose(profile: Profile, action: String) { if (profile.pin != null) pad = Pad.Check(profile, action) else act(profile, action) }
    fun actions(profile: Profile) = buildList {
        add(SheetOption("avatar", "Choose avatar"))
        add(SheetOption("rename", "Rename"))
        add(SheetOption("pin", if (profile.pin == null) "Lock with a PIN" else "Change PIN"))
        if (profile.pin != null) add(SheetOption("unpin", "Remove PIN"))
        if (profile.id != MAIN_PROFILE && profile.id != current.id) add(SheetOption("delete", "Delete profile"))
    }
    fun saveName() {
        val (profile, text) = naming ?: return
        val name = text.trim().take(20)
        if (name == "") return
        if (profile != null) update(profile.id) { Profile(it.id, name, it.colour, it.avatar, it.pin, it.position) }
        else {
            // A new profile goes straight on to its avatar.
            val id = newProfileId()
            app.saveProfile(Profile(id, name, nextColour(profiles), null, null, (profiles.maxOfOrNull { it.position } ?: 0).coerceAtLeast(0) + 1))
            dressing = id
        }
        naming = null
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(40.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AppText("Profiles", 40, Palette.foreground, FontWeight.Bold)
        AppText(
            "Profiles are on your account, so they are on all your TVs. Each has its own Continue watching, favourites and recents everywhere, and its own Home pins and caption settings on each TV. Your computer shows your own.",
            22, Palette.muted, modifier = Modifier.widthIn(max = 980.dp), lineHeight = 32,
        )
        Column(Modifier.padding(top = 24.dp).width(720.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (profile in profiles) {
                Focusable({ sheet = profile }, Modifier.fillMaxWidth().height(96.dp), RoundedCornerShape(16.dp), ring = false, background = Palette.raised, focusedBackground = Palette.foreground) { focused ->
                    Row(Modifier.fillMaxSize().padding(horizontal = 22.dp), horizontalArrangement = Arrangement.spacedBy(22.dp), verticalAlignment = Alignment.CenterVertically) {
                        AvatarDisc(profile, 60.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            AppText(profile.name, 22, if (focused) Palette.background else Palette.foreground, FontWeight.Medium, maxLines = 1)
                            AppText(
                                listOfNotNull(if (profile.id == current.id) "Watching now" else null, if (profile.id == MAIN_PROFILE) "Your account's own" else null, if (profile.pin != null) "PIN" else null).joinToString("  ·  "),
                                18, if (focused) Palette.background else Palette.muted, maxLines = 1,
                            )
                        }
                        GlyphIcon(Glyph.ChevronRight, if (focused) Palette.background else Palette.faint, 24.dp)
                    }
                }
            }
            if (profiles.size < MAX_PROFILES) {
                Focusable({ naming = null to "" }, Modifier.fillMaxWidth().height(96.dp), RoundedCornerShape(16.dp), ring = false, background = Palette.raised, focusedBackground = Palette.foreground) { focused ->
                    Row(Modifier.fillMaxSize().padding(horizontal = 22.dp), horizontalArrangement = Arrangement.spacedBy(22.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(60.dp).border(2.dp, Palette.border, CircleShape), contentAlignment = Alignment.Center) { GlyphIcon(Glyph.Plus, if (focused) Palette.background else Palette.muted, 34.dp) }
                        AppText("Add profile", 22, if (focused) Palette.background else Palette.foreground, FontWeight.Medium)
                    }
                }
            }
        }
    }

    sheet?.let { profile -> OptionsSheet(profile.name, actions(profile), { choose(profile, it) }, { sheet = null }) }

    when (val shown = pad) {
        is Pad.Check -> PinPad("Enter ${shown.profile.name}'s PIN", { digits ->
            if (!pinMatches(shown.profile, digits)) false else { pad = null; act(shown.profile, shown.next); true }
        }, { pad = null })
        is Pad.Choose -> PinPad(
            if (shown.first == null) "Choose a PIN for ${shown.profile.name}" else "Enter it again",
            { digits ->
                if (shown.first == null) pad = Pad.Choose(shown.profile, first = digits)
                else if (digits != shown.first) pad = Pad.Choose(shown.profile, mismatch = true)
                else { update(shown.profile.id) { Profile(it.id, it.name, it.colour, it.avatar, pinHash(it.id, digits), it.position) }; pad = null }
                true
            },
            { pad = null },
            note = if (shown.mismatch) "Those didn't match. Choose it again." else if (shown.first == null) "Four digits, asked for before this profile opens." else null,
        )
        null -> {}
    }

    naming?.let { (profile, text) ->
        Modal({ naming = null }) { Scrim {
            Dialog {
                AppText(if (profile != null) "Rename profile" else "Add a profile", 40, Palette.foreground, FontWeight.SemiBold)
                val field = remember { FocusRequester() }
                LaunchedEffect(Unit) { runCatching { field.requestFocus() } }
                AppField("Name", text, { naming = profile to it.take(20) }, focusRequester = field, imeAction = ImeAction.Done, onDone = { saveName() })
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End)) {
                    AppButton("Cancel", { naming = null })
                    AppButton("Save", { saveName() }, primary = true, enabled = text.trim() != "")
                }
            }
        } }
    }

    dressed?.let { who ->
        Modal({ dressing = null }) { Scrim {
            Dialog(width = 1080) {
                Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                    AvatarDisc(who, 112.dp)
                    AppText(who.name, 40, Palette.foreground, FontWeight.SemiBold)
                }
                val first = remember { FocusRequester() }
                LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    for ((index, avatar) in (listOf<String?>(null) + AVATARS.map { it.id }).withIndex()) {
                        val on = avatar == who.avatar
                        Focusable(
                            { update(who.id) { Profile(it.id, it.name, it.colour, avatar, it.pin, it.position) } }, Modifier, CircleShape,
                            focusRequester = if (on || (index == 0 && who.avatar == null)) first else null, ring = false,
                        ) { focused ->
                            Box(Modifier.border(3.dp, if (focused) Palette.foreground else if (on) Palette.muted else Color.Transparent, CircleShape).padding(6.dp).scale(if (focused) 1.1f else 1f)) {
                                AvatarDisc(Profile(who.id, who.name, who.colour, avatar, null, who.position), 84.dp)
                            }
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterHorizontally)) {
                    PROFILE_COLOURS.forEachIndexed { index, colour ->
                        val on = who.colour % PROFILE_COLOURS.size == index
                        Focusable({ update(who.id) { Profile(it.id, it.name, index, it.avatar, it.pin, it.position) } }, Modifier.size(56.dp), CircleShape, ring = false) { focused ->
                            Box(Modifier.fillMaxSize().scale(if (focused) 1.15f else 1f).background(parseColour(colour), CircleShape).border(3.dp, if (focused) Palette.foreground else if (on) Palette.muted else Color.Transparent, CircleShape))
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { AppButton("Done", { dressing = null }, primary = true) }
            }
        } }
    }

    deleting?.let { who ->
        Modal({ deleting = null }) { Scrim {
            Dialog {
                val keep = remember { FocusRequester() }
                LaunchedEffect(Unit) { runCatching { keep.requestFocus() } }
                AppText("Delete ${who.name}?", 40, Palette.foreground, FontWeight.SemiBold)
                AppText("Their Continue watching, favourites, pins and settings on this TV go too. This can't be undone.", 18, Palette.muted)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End)) {
                    AppButton("Keep it", { deleting = null }, primary = true, focusRequester = keep)
                    AppButton("Delete", { app.deleteProfile(who.id); deleting = null })
                }
            }
        } }
    }
}

@Composable
private fun Scrim(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xCC05080B)), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun Dialog(width: Int = 760, content: @Composable () -> Unit) {
    Column(
        Modifier.width(width.dp).background(Palette.raised, RoundedCornerShape(18.dp)).border(1.dp, Palette.border, RoundedCornerShape(18.dp)).padding(40.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) { content() }
}
