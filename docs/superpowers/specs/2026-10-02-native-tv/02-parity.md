# Parity: feature inventory, matrix, testing

The current Fire TV app is the functional baseline. Each ID below is a behaviour found in the code, with the file that
implements it. "Not present" items were verified by searching the code, not assumed.

Paths: `m/` = `apps/mobile/`, `c/` = `packages/core/src/`, `s/` = `packages/sync-schema/src/`, `w/` = `apps/sync-worker/src/`.

## 4. Complete feature inventory

### 4.1 Authentication and account (AUTH)

- **AUTH-01 Code sign-in, the default screen.** The TV generates an 8-character code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown as `XXXX-XXXX` (font 96, tracking 8).
  It shows the address `testcard-sync.evcalex.workers.dev/link` and a QR code (380 design px) for `https://…/link#<code>`, plus a countdown ("The code lasts m:ss more.").
  Phases: "Getting a code..." → "Waiting for you…" → "Signing you in..." → failure text plus **Try again**. An expired code is replaced silently.
  It polls `/link/poll` every 2 s, survives dropped polls, and has a **Use email and password** button. Lookup = PBKDF2(code, "testcard-link-lookup-v1", 210k); secrets are opened with AES-GCM under PBKDF2(code, salt). `m/src/screens/SignIn.tsx`, `c/sync/linkSession.ts`, `c/sync/linkCrypto.ts`.
- **AUTH-02 Account creation from the phone.** The `/link` page on the Worker can create an account. The TV just receives `{email,password}`, so it has no TV-side difference. `w/pages/linkPage.ts`.
- **AUTH-03 Email/password form.** Fields Email (preferred focus; email keyboard) and Password (secure). The error text is seeded with `status.lastError`.
  Buttons: **Use a code instead**, **Sign up**, **Sign in** (disabled while busy or a field is empty; label "Working..."). The form moves to the top while the keyboard is shown.
- **AUTH-04 Sign-up confirmation.** "Create a new account?" with an explanation; **Go back** (primary, preferred) / **Create account**. Back means no.
- **AUTH-05 Sign-up flow.** `POST /auth/sign-up/email {email,password,name:email}` → token is persisted → 16-byte random salt → `POST /sync/salt` → session finalised → periodic sync starts → immediate sync. Automatic login: there is no separate sign-in step.
- **AUTH-06 Auth error words** (`authFailure`):
  - no HTTP status → "Can't reach the sync server. Check your connection and try again."
  - sign-in 400/401 → "That email and password don't match an account."
  - sign-up 409/422 → "An account with that email already exists. Sign in instead."
  - 5xx → "The sync server had a problem. Try again in a moment."
  - otherwise the server's `message`/`error`, else "That didn't work. Check your details and try again."
- **AUTH-07 Session persistence.** Email, session token and salt live in `sync_state`; the account password lives in the Keystore. Relaunch resumes without sign-in.
- **AUTH-08 Expired session.** A 401 triggers a silent re-sign-in with the stored password. A 4xx rejection forgets the session with "Your session expired. Sign in again to keep syncing." (shown on the sign-in form). Offline keeps the session and retries later.
- **AUTH-09 needs-password state.** Email is known but no password is stored → the sign-in screen is shown (anything not `signed-in` shows it).
- **AUTH-10 Sign out.** A confirmation modal ("Sign out?" … "You will need your account password.") with **Stay signed in** (preferred) / **Sign out**. Server sign-out is best-effort; locally the token, salt, cursors and password are cleared. **Sources and catalogue stay in the database.**
- **AUTH-11 No device registration.** Verified: no device id, push token or device table exists anywhere.
- **AUTH-12 Request details.** Every `/auth` and `/sync` request carries `Origin: <baseUrl>`, Bearer token when authed, and a 15 s timeout covering the body. `c/sync/client.ts`.

### 4.2 Profiles (PROF)

- **PROF-01 Who's watching?** It opens at launch when there are 2 or more profiles. Avatar tiles (176) with names, with the current one preferred. An **Add profile** tile appears while there are fewer than 6.
  It also has a **Manage profiles** button and "Switching to X..." while swapping. `m/src/screens/WhoIsWatching.tsx`.
- **PROF-02 PIN entry.** A PIN-locked profile asks for its PIN on a 3×4 on-screen pad (keys 1–9, blank, 0, erase; **5** preferred; four dots; "That's not the PIN. Try again."). Re-picking the profile already watching from the nav bar needs no PIN. `m/src/ui/PinPad.tsx`.
- **PROF-03 Back.** At launch, Back exits the app; opened from the nav bar, Back returns.
- **PROF-04 Switching** (`state/app.tsx` `switchProfile`):
  1. Push the leaving profile's changes (wait at most 3 s).
  2. Pause sync, aborting in-flight requests.
  3. Swap the personal rows and the `ui:captions`/`ui:audio` meta in one transaction.
  4. Write `ui:profile`, set the sync profile, reload captions and audio.
  5. Resume sync, which pulls immediately.

  The app then returns to Home with only Home visited.
- **PROF-05 Nav avatar button.** It appears when there are 2 or more profiles and opens the chooser.
- **PROF-06 Settings → Profiles pane.** Rows show the avatar plus tags "Watching now", "Your account's own" and "PIN". OK opens a sheet:
  - Choose avatar
  - Rename
  - Lock with a PIN / Change PIN
  - Remove PIN (only when locked)
  - Delete profile (not Main, not the profile watching)

  A locked profile asks for its PIN before any of these. `m/src/ui/ProfileSettings.tsx`.
- **PROF-07 Add profile.** A name dialog (max 20 characters, trimmed, Save disabled while empty), then the avatar picker for the new profile. Its colour is `nextColour`, its id is `p<base36 time><base36 rand>`.
- **PROF-08 Avatar picker.** Letter (null) plus 24 emoji avatars by stable id and 8 colours; each change saves and syncs.
- **PROF-09 Set PIN.** Choose, then confirm; a mismatch shows "Those didn't match. Choose it again."; stored as `pinHash(id, digits)` (FNV-1a hex). It keeps children out; it is not a security boundary.
- **PROF-10 Delete profile.** The confirmation "Delete X?" offers **Keep it** (preferred) / **Delete**. It writes a tombstone and drops the profile's stash on this device.
- **PROF-11 Profile sync.** Profiles sync encrypted (`ProfilePayload`), last write wins. When the watching profile is deleted elsewhere, the app switches to Main and forgets the deleted profile.
- **PROF-12 Old local list import.** A `ui:profiles` list from builds before profiles synced is imported once (`readProfiles`). This only matters if the old database is adopted.
- **PROF-13 What belongs to a profile.**
  - Synced per profile under `p.<id>.`: channel favourites and recents, movie and series favourites and recents, playback progress, tombstones, `pending_channel_sync`.
  - Kept per profile on the device only: Home pins (Main's sync), captions, audio language.
  - Each profile keeps its own pull cursor (`sync_pulled:<id>`). Pins that arrive for Main while another profile watches are held (`holdPinsForMain`/`applyHeldPins`).

### 4.3 Sources and imports (SRC, IMP)

- **SRC-01 Sources arrive by sync.** A new source is inserted with a fresh local UUID and imported at once. An edit from another device (rename, login, content switches, backups, pins, skips, EPG URL, hidden, position) is applied when newer. A removal elsewhere removes the source unless it was re-added here later.
- **SRC-02 Add source.** A modal with **Xtream login** / **Playlist link (M3U)** chips; fields Name, Server address, Username, Password, Backup server addresses (Xtream) or Playlist link, then TV guide address and Load (Live TV / Movies / Series ticks).
  - Validation messages:
    - "Give the source a name."
    - "Choose at least one of Live TV, Movies and Series."
    - "That's not a server address."
    - "A server address starts with http:// or https://."
    - "Enter the username and password."
    - "Couldn't reach that server. Check the address."
    - "The provider turned down that username and password."
    - "That's not a playlist link."
    - "Couldn't reach that playlist. Check the link."
    - "The playlist link answered with HTTP n."
    - "The TV guide address must be a link…"
    - `"x" is not a server address.`
  - A pasted `get.php` link is saved as an Xtream login.
  - Footer: "Checking with the provider...", or "Changes reach your other devices when they next sync."

  `m/src/ui/SourceForm.tsx`, `m/src/state/sourceEdit.ts`.
- **SRC-03 Edit source.**
  - The password is blank, meaning unchanged.
  - Xtream: a changed login is probed then saved; the source keeps its remote key and `base_url` (identity).
  - M3U: a changed link must not be an Xtream link ("That's an Xtream link. Remove this source…"); the remote key is kept.
  - A changed login, link or content switch triggers a reload (import); otherwise only the guide refreshes.
- **SRC-04 Remove source.** Press twice ("Press again to remove"). It waits for any in-flight import, records a tombstone and deletes the credentials.
- **SRC-05 Refresh.** The button reads Refresh, "Refreshing" (disabled) or "Try again" after a failure. A second refresh of the same source joins the running one.
- **SRC-06 Source card.**
  - Name and kind (Xtream/M3U), plus counts ("12,345 channels, 4,321 movies, 210 series", or "Nothing loaded yet"; "Loading...").
  - The Xtream account line, with a warning colour: expiry "Expires d Mon yyyy" / "Expires in n days" / "Subscription expired" / "Account <status>" / "No end date", Trial, and "n of m streams in use".
  - "Main server not answering. Using host" when a backup is in use.
  - "✓ Synced x ago", or a problem block (titles: "Couldn't refresh this source", "Movies and series didn't load", "Movies didn't load", "Series didn't load"), with plain reasons and "What loaded last time is still here."
- **SRC-07 Backup servers.** Each address gets 8 s to answer `probeXtream`, main address first. Checks run at launch +10 s, before an import, after a play or episode-load failure with an "unreachable" error, and once per play. The address in use is remembered in `schema_meta server:<id>`. `m/src/state/hosts.ts`.
- **SRC-08 Source pick.** A nav chip appears when there are 2 or more sources. A picker lists "All sources" and each source, and the choice persists (`ui:source`). It scopes Home, Live, Movies, Series, Search and the user's own rows. A removed source counts as All. Posters show the source name when 2 or more sources have VOD.
- **SRC-09 Content switches** (`include_live/movies/series`) are synced.
- **SRC-10 Source order.** The synced `sort_order` is applied. The TV has no reorder UI.
- **SRC-11 Account info.** `user_info` is cached for 5 min and drives the refused-stream explanations (PLY-08).
- **IMP-01 Catalogue import** (`c/db/importCatalogue.ts`).
  - M3U: one streaming fetch and parse splits entries into live and VOD (`classifyEntry`); VOD is removed from live.
  - Xtream: categories, then streams with 4 requests at a time; then VOD and series, best-effort.
  - Diff-merge only (no deletes); unchanged rows are not rewritten; `last_refreshed_at` is stamped.
  - Ids are deterministic (`groupVariants` NUL-joined keys; U+0001 stored on Android).
- **IMP-02 Setup screen** (`m/src/ui/SetupOverlay.tsx`, `state/setup.ts`). It covers the app on the first sync, during **any** import, and for the launch catch-up (shown at least 0.7 s, at most 10 s).
  - Steps: Account secured / Your sources / one step per source with a note (Live channels · Movies · Series, Playlist, or Nothing to load) / Watch history.
  - A native-animated bar with a glint, a percentage, and a one-line detail (e.g. "Strong: loading movies").
  - A "Press back again to exit" toast.
- **IMP-03 After an import:** immediate sync (history for the new titles), then a background guide refresh.
- **IMP-04 Failures** are reported per part (movies, series, or all) and kept on the source card.
- **IMP-05 Open-time maintenance.** `renameChannels` when `DISPLAY_NAME_VERSION` changes (synchronously at open); `reclassifyCategories` when `CLASSIFIER_VERSION` changes (deferred, chunked).
- **IMP-06 Remote keys.** Reused from stored rows when a sampled key still matches; otherwise computed.
- **IMP-07 Lazy details.** Film plot, duration and container extension are fetched on detail open or after the hero rests 700 ms (Xtream only). Series episodes are fetched on open and again after 24 h; a failed re-read keeps the episodes already shown.

### 4.4 Sync (SYNC)

- **SYNC-01 When.**
  - Every 60 s; 3 s after a local change (at least 15 s apart).
  - At launch: blocking, up to 10 s.
  - On returning to the foreground, after every import, and from **Sync now**.
  - A "Syncing…" label shows in the nav while the launch or foreground catch-up runs.
- **SYNC-02 Up and down.**
  - Sources, carried in an encrypted payload: login or link, `keyHost`, `backupHosts`, content, position, pins (Main only), skips, `epgUrl`, hidden.
  - Profiles (encrypted).
  - Movie and series favourites and recents, and progress (position, duration, watched).
  - Channel favourites (with `position`) and recents.
  - Tombstones for all of these.
- **SYNC-03 Never synced.** Captions prefs, audio language, source pick, per-channel picture fit, update settings, guides and the catalogue itself.
- **SYNC-04 Conflicts.**
  - Last write wins on client `updatedAt`, on the server and locally.
  - Rows for titles not imported yet hold the pull cursor back; channel rows wait 30 days in `pending_channel_sync` instead.
  - A cleared position for a missing title is skipped. A source re-added after its remote removal is kept.
- **SYNC-05 Offline.** The app is fully browsable from the local DB. Sync errors read:
  - "Can't reach the sync server. It will retry shortly."
  - "The sync server had a problem…"
  - "Sync isn't authorised. Sign in again."

  They are shown on the Sources pane, and the next tick retries.
- **SYNC-06 One-time flags.** `sync_source_edits_reread` (pull from 0 once) and `sync_epg_urls_sent` (re-push guide URLs once).
- **SYNC-07 Screens re-read.** When a sync brought anything new (`lastChangedAt`), screens re-read and the guide queue is re-checked.
- **SYNC-08 Player pick-up.** A paused VOD jumps to a newer position from another TV ("Picked up at h:mm:ss from your other TV", shown 5 s).
- **SYNC-09 Cross-device channel history is broken** (see README). Parity means the same wire behaviour, not a fix.

### 4.5 Home (HOME)

- **HOME-01 Rows, in order.** Each is shown only if non-empty and scoped to the source pick:
  1. **Continue watching**: films unfinished (`shouldPromptResume`, not watched) and shows, by most recent across both, up to 30. A film's note reads "1h 5m left"; a show's reads "S2 E3" or "Next · S2 E4" with episode progress.
  2. **Recently watched channels** (up to 30).
  3. **My list** (favourite films then series, up to 30).
  4. **Favourite channels** (up to 30, in the viewer's order).
  5. **Pinned categories** in pin order (live 24, VOD 30), labelled from the current category name via `displayName`, with a "Pinned" badge.
  6. **New movies**, **New series**.
  7. **Top 10 movies this year** (ranked numerals).
- **HOME-02 Hero.**
  - It follows the focused card after 240 ms, or the first row's first item at rest.
  - Contents:
    - a kicker with the row label;
    - the title (2 lines; then the plot drops to 1 line);
    - facts: year, runtime, rating (0–10, one decimal), 4K;
    - the plot, fetched after a 700 ms rest if missing;
    - "OK · Hold for more options".
  - Channels show a logo panel instead of art, plus a **NOW** line (title, progress bar, "x left") and a next line (HH:MM title), or "No programme guide for this channel". The guide is re-asked when the programme ends.
- **HOME-03 OK on a card.** A film or series opens its detail page; a channel plays, zapping through that row.
- **HOME-04 Hold OK (longSelect)** opens an options sheet:
  - Films: Play/Resume, More info, Add to / Remove from My list.
  - Series: Resume/Play SxEy (or View episodes), View episodes, My list.
  - Channels: Watch live, Add to / Remove from Favourites, Remove from Recently watched (when in recents), Move earlier/later in Favourites (in the favourites row), Hide this channel.
  - Plus, by row: Remove from Continue watching (that row), Remove this row from Home (a pinned row).

  The release after a hold is ignored for 800 ms.
- **HOME-05 States.** A skeleton while rows first build. Empty: "Nothing here yet. Sign in to the account your computer uses…". Rows are persisted across launches in `schema_meta rows:movies` and `rows:series`.
- **HOME-06 Back.**
  - On a page, Back goes to the nav tab, the rows reset to the top, and the hero resets.
  - On the nav bar, Back twice within 2.5 s exits, showing the toast "Press back again to exit".
- **HOME-07 Layout.** The focused row snaps under a top band (fade); the next row's title peeks in at the bottom fade.

### 4.6 Live TV (LIVE)

- **LIVE-01 Landing.** The hero plus rows: Recently watched (30), Favourites (30), then the first 10 non-empty categories (excluding junk, separator, adult and hidden ones) with 24 channels each.
  Header buttons are **All categories** and **TV guide**. The rows are deferred 30 ms behind a skeleton.
- **LIVE-02 Browse all (pills layout).**
  - Pills: Recently watched, Favourites, All channels, then the categories.
  - A 4-column grid of channel cards (logo panel, name, number).
  - An **On now** strip for the channel the remote rests on (after 350 ms; the answer is cached 5 min): logo, "number name", title, progress, "HH:MM to HH:MM   Next HH:MM title", "No guide for this channel".
  - **Pin to Home** / "Pinned to Home. Press to remove", with the note "Added to your Home page" for 3 s.
  - **Hide category**, pressed twice ("Press again to hide it").
  - A count line ("x channels"), pages of 60 up to 600, and the open category remembered per section.
- **LIVE-03 Zap list.** Playing from a list zaps through that list; a list of one zaps through the first 300 channels (scoped).
- **LIVE-04 Hidden items are left out everywhere:** rows, lists, search, the guide, zap lists and counts.
- **LIVE-05 Logo fallback.** A 4-letter monogram (`monogram`) on a tone hashed from the name; a broken URL falls back to it.
- **LIVE-06 Ordering.** Provider order (`rowid`); favourites by `position` then newest; recents newest first.
- **LIVE-07 Not present (verified).** No country filter, number entry, channel up/down keycodes or EPG search on the TV.

### 4.7 Guide and catch-up (EPG)

- **EPG-01 Guide grid** (`m/src/screens/Guide.tsx`).
  - List pills: Favourites, Recently watched, the categories, All channels (up to 2,000).
  - A 2 h window with 30 min ruler slots, a now line (refreshed every 30 s), and a day label (Today / Tomorrow / weekday).
  - Right at the last block pages +1 h (up to 24 h ahead); Left at the first block pages −1 h (not before the current slot). A press that moved focus there in the last 350 ms does not page.
  - A details panel shows the channel, title, "On now HH:MM to HH:MM n min left" or the day and times, and "OK to watch X".
  - Cells: title (with "‹ " when clipped), times, "No listings", and blank while loading. Focus is kept while a row loads.
  - OK plays the channel, zapping through the first 300 of the list.
- **EPG-02 Listings source.** The imported guide (−6 h…+36 h), else Xtream `get_short_epg` limit 24, with 3 channels at a time (newest request first) and a 20 min cache.
- **EPG-03 Now/next.** Imported guide first, else short EPG, else `get_simple_data_table` for channels with catch-up. Only the latest request runs (older ones are dropped). The answer is cached until the programme ends (at most 30 min), or 5 min.
- **EPG-04 XMLTV import.**
  - Eligible sources have an explicit `epg_url`, live content on, and channels.
  - A guide is stale after 12 h or when its address changes; a failure is retried after 1 h; 60 s to first byte; a 36 h horizon; 6 h of past listings are kept.
  - The Worker's shared file is used when the URL qualifies (`isSharableGuideUrl`) and the file is no older than 48 h; otherwise the guide is streamed and parsed directly.
  - Runs one source at a time, never during an import. Triggers: launch +60 s, foreground, after an import, when a sync brought changes, and after a source is saved.
  - A one-off cleanup drops guides of sources with no address (`guides_trimmed`).
- **EPG-05 Guide registration.** `POST /guides/register` with the public URL; the reply names the file.
- **EPG-06 Player programme line (live).** The title and HH:MM to HH:MM, with a progress bar of the programme; re-asked when it ends, or every 5 min with no guide.
- **EPG-07 Catch-up** (Xtream `tv_archive`). The **Catch up** key opens a list:
  - "Start over" for what is airing now, then archived past programmes within `catchup_days`, newest first, labelled Today / Yesterday / weekday and HH:MM.
  - States: "Loading...", "Couldn't reach the provider…", "Nothing to play back…".
  - Playing an entry builds a timeshift URL; the pill shows **CATCH-UP** and the Live key reads "Back to live".
  - Changing channel returns to live.

### 4.8 Player (PLY)

- **PLY-01 Stream URLs.**
  - Xtream live: `{base}/live/{u}/{p}/{id}.ts`.
  - Movie: `{base}/movie/{u}/{p}/{id}.{ext}`; episode: `{base}/series/…`.
  - Timeshift: `{base}/timeshift/{u}/{p}/{mins}/{YYYY-MM-DD:HH-mm}/{id}.ts`.
  - M3U: the stored URL.

  Credentials are **concatenated raw, not URL-encoded**. URLs are never shown or logged.
- **PLY-02 Loading.** A black screen with a spinner; Back exits.
- **PLY-03 Live feed failover** (`listChannelFeeds`).
  - On error, or no picture within 15 s, the next variant or same-named channel in the same country is tried.
  - Message while switching: "Trying another feed...". Once playing: "That feed wouldn't play. Playing the X feed instead." (5 s).
- **PLY-04 Film copies** (`listMoviePlayOrder`). 4K and the first source come first. The next copy is tried only if this one never really played (under 8 s). Its resume point is carried over. Message: "Playing the 4K copy from S instead".
- **PLY-05 Backup servers.** Once per play, on an unreachable error: "The provider's server isn't answering. Trying its other addresses...", then a re-resolve if another server answers.
- **PLY-06 Stuck live.** A live stream stuck loading 12 s after it had played is reloaded, at most 4 times.
- **PLY-07 Behind live.** After a pause longer than 2 s, the pill reads **BEHIND LIVE** and **Live** reloads the stream.
- **PLY-08 Failure screen.**
  - Messages:
    - decoder (`EXCEEDS_CAPABILITIES|MediaCodec|Decoder`): "This device can't decode this video…" (no Try again)
    - 401/403: "The provider refused this stream."
    - 404/410: "…no stream at that address…"
    - server gone (`UnknownHost…`): `plainReason`, plus **Edit source** (opens the form, then retries)
    - network: "Couldn't reach the stream…"
    - else "This couldn't be played." with the raw detail
  - The Xtream account explanation overrides the message: "subscription has ended", "allows one stream… in use", "allows n streams…", or status.
  - Buttons: **Try again**, **Back**.
- **PLY-09 Chrome.**
  - It fades after 4 s; any key wakes it; Back hides it before leaving.
  - Top: a back chevron and the wall clock.
  - Bottom:
    - a pill: LIVE (dot) / CATCH-UP / BEHIND LIVE;
    - the title (`playerTitle`) and programme line;
    - chips: quality (4K/1440p/1080p/720p/SD), fps, codec (HEVC/H.264/AV1/VP9/MPEG-2) and HDR/HLG;
    - the bar: VOD shows buffered, played and a knob; live shows programme progress or the live edge;
    - VOD: "m:ss / m:ss   Ends HH:MM"; live: "x of n".
- **PLY-10 D-pad model.** Rows of controls are navigated by Up/Down and Left/Right, starting on Play.
  - VOD: `[exit] [seek] [back, play, forward, captions?, next?] [options]`.
  - Live while zapping: `[exit, live, back, play, forward, last?, catchup?] [options]`.
  - Live otherwise: `[exit, live, play, last?, catchup?] [options]`.

  The options row is hidden until it is reached. The selection carries across channel changes.
- **PLY-11 Seeking (VOD).**
  - ±15 s per press; a streak (presses within 600 ms) grows the step to 15, 30, 60, then 120 s.
  - With the controls hidden, Left/Right seek at once.
  - Holding Left/Right/RW/FF scrubs every 150 ms with a growing step (10/30/60/120 s); release commits; stops after 300 ticks.
  - Tapping the bar seeks (phone only).
- **PLY-12 Zapping (live).**
  - Up/Down change channel when the controls are hidden or the viewer is "surfing" (stays true across channel changes until another key).
  - Prev/next keys on the transport row; the list wraps; "x of n".
  - The **Last** key flips to the previous channel (label "Last: <name>", truncated to 16).
- **PLY-13 Play/pause.** The media key toggles once (a 450 ms check defers to the media session); OK on the Play key toggles; 500 ms debounce; a pulse flash.
- **PLY-14 Rewind and fast-forward keys** step (seek, or zap on live).
- **PLY-15 Captions (VOD only).**
  - The CC key is disabled with no tracks. Its panel lists Off and each track ("On now" marks the current), then "Style and default" settings changed with Left/Right.
  - Captions come on automatically once per stream when "always" is set and the language matches (a full track is preferred over forced). Never on live. A provider's default track is overridden off.
  - Style via Media3 `CaptionStyleCompat`: scale 0.8/1/1.3/1.65, colours, background, edge.
- **PLY-16 Audio.** The option appears when there are 2 or more tracks: a list ("On now"); choosing remembers the language; the remembered language is applied automatically once per stream.
- **PLY-17 Picture.** Cycles Fit/Fill/Stretch, kept per channel (`ui:fit:<channelId>`, deleted when Fit); films start at Fit.
- **PLY-18 Speed** (VOD and catch-up only). Cycles 1×, 1.25×, 1.5×, 2×, 0.75×; never kept.
- **PLY-19 Progress and recents.**
  - The first play records a recent: channel (not in catch-up), film or series.
  - VOD position is saved every 5 s when it has moved 2 s or more, and on exit. An untouched paused player writes nothing.
  - Each save nudges sync.
- **PLY-20 Next episode.** When an episode with a next one ends (duration over 300 s and the end reached), a card reads "Next: SxEy name" with **Next episode** and an 8 s fill countdown, then autoplays.
  OK with the controls hidden plays now; any other key cancels the countdown. Seeking back resets the offer. There is also a Next key on the transport row.
- **PLY-21 Pick-up from another TV** (SYNC-08).
- **PLY-22 Buffering.**
  - VOD: target 40 s, play at 2.5 s, cap 64 MB. Live: target 60 s, play at 2.5 s, cap 48 MB.
  - min = max = target; time updates every 0.5 s (VOD) and 1 s (live).
- **PLY-23 Screen stays on while playing** (expo-video default `keepScreenOnWhilePlaying`).
- **PLY-24 Stream User-Agent.** Media3 default: `Testcard/<versionName> (Linux;Android <rel>) AndroidXMedia3/1.9.0`, via an OkHttp data source.
- **PLY-25 Ignored keys.** Key-down duplicates are ignored; the only key events used are releases and long-press starts and ends.

### 4.9 Movies (MOV)

- **MOV-01 Landing.**
  - Rows: Continue watching (unfinished films, "x left"), My list (30).
  - Shelves of 16 titles, de-duplicated across the page by `titleKey`, poster required, no adult/junk/separator or Asian-named categories, in the device language or unlabelled/multi, a shelf needing 6 titles:
    - Top 10 this year (ranked),
    - New releases (this or last year, by year then first seen),
    - Top rated (0 < rating < 9.9),
    - up to 8 genre rows (most populous genres).
  - An **All categories** button.
- **MOV-02 Browse.**
  - A left menu: Continue watching, My list, All movies (summed count), Genres (expandable, `genreOptions`), categories (tidied names, counts, hidden excluded). The selection opens after a 160 ms rest.
  - A 7-column poster grid; pages of 60 up to 600; dated titles shown once.
  - Pin to Home / Hide category; the selection is remembered.
  - Empty texts: "No movies yet", "Nothing in here yet.", and the scoped-source hint.
- **MOV-03 Detail.**
  - A blurred backdrop, poster, title, facts (year, runtime, 0 < rating < 10) and plot (fetched lazily).
  - Actions:
    - **Play** / **Resume from h:mm:ss** (with progress)
    - Start over
    - Add to / Remove from My list
    - Mark as watched / unwatched
    - Other versions (n): a sheet of "4K/HD · tag · source"
    - Remove from Continue watching (then back)
  - The focused icon's name shows beneath. Missing film: "That movie is no longer in your library." with **Back**.
- **MOV-04 Poster card.** Art (TMDB `w342`), a 4K badge, a source badge (when mixed), a progress bar or watched tick, and the title (2 lines, or 1 with a note).

### 4.10 Series (SER)

- **SER-01 Landing.** Rows: Recently watched (20, "S2 E3" / "Next · S2 E4" with progress) and My list. The same shelves as Movies. **All categories**.
- **SER-02 Browse.** My list, All series, Genres, categories; a 7-column grid; Pin/Hide.
- **SER-03 Detail.**
  - A backdrop, poster, `seriesTitle`, facts (year, n seasons, n episodes, rating) and plot.
  - Actions:
    - **Resume/Play SxEy** (with progress)
    - Start over
    - My list
    - Mark <Season> as watched/unwatched
    - Other versions (n)
    - Remove from Continue watching
  - Skeletons pulse while loading. Errors: "The episodes didn't load. <reason>" with **Edit source** (server gone), **Try again**, **Try another version**.
  - A backup-server retry runs once. A daily re-read that fails keeps the list. Empty: "This series has no episodes."
- **SER-04 Episodes.**
  - Season pills when there is more than one; the default season is the up-next one.
  - A grid of 2–6 columns by width.
  - Cards: a still, else a borrowed blurred season/show poster behind a veil, else a film glyph (falls through on broken links); an "E#" badge; a Watched badge and veil; progress; the title; "Resume from m:ss" or the runtime.
  - The grid starts scrolled to the next unwatched row, which is aligned to the top on focus. "Hold select on an episode for more".
- **SER-05 Episode hold sheet.** Mark as watched/unwatched, Mark watched up to here (not on the first), Play from the start.
- **SER-06 Borrowed seasons.** Up to 3 other copies (same quality first) fill empty or missing seasons; empty seasons are hidden.
- **SER-07 Up next.** Resume an in-progress episode, else the first unwatched (`upNextIn`, `getUpNextEpisode(s)`, `findNextEpisode`).

### 4.11 Search (SRCH)

- **SRCH-01 Search tab.** Choosing Search opens the system keyboard at once; the bar is a focus stop that opens the keyboard on OK.
  - It searches from 2 characters, 200 ms after the last key, as FTS5 per-word prefix queries (`"word"*`).
  - Rows: "Movies n", "Series n", "Channels n" (24 each, poster first, deduped by `titleKey` or name).
  - Source names show when results span sources. The last query is remembered.
  - Empty texts: "Search movies, series and channels" / "Type at least two letters…" / `Nothing found for "x"`.
  - A channel plays with the result list as the zap list.
- **SRCH-02 Scope.** Search follows the source pick; hidden, adult, junk and separator categories are excluded.

### 4.12 Settings (SET)

- **SET-01 Settings tab** (gear; an accent dot when an update is available). Panes: Sources, Hidden, Profiles, Captions, Account and updates. The pane follows the menu focus.
- **SET-02 Hidden pane.** Each entry shows its label, kind ("Live TV category" / "Movies category" / "Series category" / "Channel") and the source name when there are several sources, with **Show again**. Empty text: "Nothing is hidden…".
- **SET-03 Captions pane.** Groups: When (On for films and episodes: "Only when I turn them on" / "Always"; Language: Any plus 19 languages) and Look (Size, Text colour, Background, Text edge). Each opens a choice list with a live preview beside it. Device-only, per profile.
- **SET-04 Account and updates.**
  - Email, "✓ Synced x ago", **Sync now**, **Sign out** (AUTH-10).
  - "Testcard <version> · <update status>". The status reads one of: "Updates are not set up…", "Couldn't check…", "Downloading n%", "Checking for updates...", "Version x is available.", "You are up to date.", "Not checked yet."
  - **Check automatically: On/Off**, and **Check for updates** / **Update now**.

Which settings are TV-only and which are shared:

- **TV/device-only:** captions, audio language, picture fit, source pick, update auto-check.
- **Shared via sync:** sources and their fields, hidden, pins (Main), profiles and PINs.

### 4.13 Updates (UPD)

- **UPD-01 When.** A check 8 s after launch, every 6 h, and on returning to the foreground when the last check was over 6 h ago. It can be switched off (`update:auto`).
- **UPD-02 Prompt.**
  - The modal "Testcard x is ready", "You have y.", and up to 12 change lines (or "Fixes and improvements.").
  - **Later**: an automatic check does not offer that versionCode again (`update:skipped`).
  - **Update now**: downloads into cache with progress; a stall over 45 s aborts; old APKs are cleaned; the file moves into place only when whole.
  - Installs through a `PackageInstaller` session that reports a refusal.
  - When installs are not allowed: "Android needs your OK first…" with **Open settings**; the install continues on return.
  - Never shown over the player or the setup screen.
- **UPD-03 No forced updates** (verified).
- **UPD-04 Manifest.** `GET {worker}/app/latest.json` (no-cache) gives `{versionCode, versionName, apks:{firetv}, notes[]}`; an update is offered when `versionCode` > the installed one.

### 4.14 TV interaction (TVUX)

- **TVUX-01 Nav bar.** The "test**card**" brand, a Search icon, Home, Live TV, Movies, Series, the "Syncing…" label, the source chip, the profile avatar, and the Settings gear with an update dot.
  The active tab has an underline; the focused tab sits on a glass pill. The active tab is preferred focus.
- **TVUX-02 Sections stay alive.** A section is drawn the first time it is opened and keeps its scroll, focus and open category.
- **TVUX-03 Overlays.** Detail pages and the player cover the shell. On return, focus goes back to the opener (retried at 0, 120, 300 and 600 ms).
- **TVUX-04 Back, everywhere.** Each Back closes the innermost thing open, in this order:
  - **Sheets, pickers and the PIN pad** close.
  - **The player:** the catch-up, captions or audio panel closes first, then the controls hide, then the player exits.
  - **Detail pages** go back.
  - **Browse and the guide** return to the landing rows.
  - **Pages** move focus to the nav bar.
  - **The nav bar** asks for a second press to exit.
  - **Sign-up confirmation** means no.
  - **Who's watching:** exits at launch, or returns when opened from the nav.
- **TVUX-05 Hold OK** (`longSelect`) opens options on Home, Live, Movies and Series cards and on episodes; the release that ends a hold is ignored.
- **TVUX-06 Focus traps.** Sheets, the source picker and the PIN pad trap focus in all four directions.
- **TVUX-07 Sizing.** Design units of 1920 are scaled to the window (`uiScale`, clamped 0.4–1.5); Inter 400/500/600.
- **TVUX-08 Text entry.** The system on-screen keyboard is used for search, sign-in, source forms and profile names.
- **TVUX-09 Not present (verified).** The Menu key, number keys, a screensaver of the app's own, an idle timeout, voice search, and mouse or pointer-specific behaviour.
- **TVUX-10 Exit.** Double Back from the nav bar, or from the setup screen.

### 4.15 Error, loading and empty states (ERR)

- **ERR-01 Crash screen.** "Something went wrong" with **Try again**: the component exists but is **not mounted** (bug).
- **ERR-02** Every loading, empty and error string listed above, kept word for word.

### 4.16 Accessibility, localisation, theming (A11Y)

- **A11Y-01** English-only strings; no i18n framework.
- **A11Y-02** The device language (`Intl` locale) steers Home shelves (category language) and the captions/audio language defaults.
- **A11Y-03** Dark theme only (the colour tokens in `m/src/theme.ts`, a cream accent).
- **A11Y-04** No `accessibilityLabel`s anywhere (verified); screen readers get default text.
- **A11Y-05** Large text sizes for sofa distance; type scale body 22 / small 18 / lead 28 / title 40 design px.

## 5. Parity matrix

Reuse: **V** = TS behaviour reproduced in Kotlin and proven by shared test vectors; **SQL** = SQL text copied verbatim;
**K** = existing Kotlin reused as is; **–** = rewrite from the spec above. Complexity: S/M/L.
Tests: **U** JVM unit (vectors), **D** DB golden (same inputs, same query outputs as TS), **X** cross-client sync against a
local Worker, **C** Compose UI test, **I** instrumented on emulator, **M** manual device script (see §12).

| ID | Current implementation | Location | Native replacement | Reuse | Cx | Parity test |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH-01 | linkSession + linkCrypto, QR via qrcode-generator | `m/src/screens/SignIn.tsx`, `c/sync/link*` | `LinkSession` (coroutines), PBKDF2/AES in `:core`, QR via ZXing core | V | M | U (code/lookup/open vectors), X (approve via TS test page helper), M |
| AUTH-02 | Worker page | `w/pages/linkPage.ts` | unchanged | – | S | X |
| AUTH-03/04 | SignInScreen form + confirm | `m/src/screens/SignIn.tsx` | Compose screen | – | S | C, M |
| AUTH-05 | SyncController.signUp | `c/sync/syncController.ts` | `SyncController.signUp` | V | S | X |
| AUTH-06 | authFailure strings | same | same mapping | V | S | U (status→message table) |
| AUTH-07 | sync_state + SecureStore | `m/src/platform/secrets.ts` | sync_state + Keystore-wrapped prefs | – | M | I, M (relaunch) |
| AUTH-08 | reauthenticate | `c/sync/syncController.ts` | same algorithm | V | S | X (expire token) |
| AUTH-09/10 | status gate, signOut | `App.tsx`, controller | same | V | S | X, C |
| AUTH-11 | none | — | none | – | – | review |
| AUTH-12 | SyncClient headers/timeouts | `c/sync/client.ts` | OkHttp client, `Origin`, Bearer, `callTimeout(15s)` | V | S | X |
| PROF-01..03 | WhoIsWatching, PinPad | `m/src/screens/WhoIsWatching.tsx` | Compose | – | M | C, M |
| PROF-04 | switchProfile + swapProfile | `m/src/state/app.tsx`, `c/db/profileSwap.ts` | `ProfileRepository.switch` | V/SQL | M | D (stash round trip), X (per-profile pulls) |
| PROF-05..10 | ProfileSettings | `m/src/ui/ProfileSettings.tsx` | Compose | – | M | C, M |
| PROF-09 | pinHash | `c/db/profileIdentity.ts` | same FNV-1a | V | S | U |
| PROF-11 | applyRemoteChanges profiles | `c/sync/localChanges.ts` | same | V | M | X |
| PROF-12 | readProfiles legacy import | `c/db/profileIdentity.ts` | needed only for DB adoption | V | S | D |
| PROF-13 | PERSONAL_TABLES, PROFILE_META_KEYS | `c/db/profileSwap.ts` | same lists | SQL | S | D |
| SRC-01 | onDecryptedSource / onRemovedSource | `c/sync/syncController.ts` | same | V | M | X |
| SRC-02/03 | sourceEdit + SourceForm | `m/src/state/sourceEdit.ts`, `m/src/ui/SourceForm.tsx` | `SourceEditor` + Compose form | V | M | U (validation table), C, M |
| SRC-04 | removeSource + removeSourceRows | `m/src/state/app.tsx`, `c/sync/sourceRemoval.ts` | same | SQL | S | D, X |
| SRC-05 | refreshSource in-flight map | `m/src/state/app.tsx` | `ImportManager` (one job per source) | – | S | U |
| SRC-06 | SourcesPane, account lines | `m/src/screens/Sources.tsx`, `m/src/state/account.ts` | Compose + `describeAccount` | V | M | U (describeAccount), C |
| SRC-07 | hosts.ts | `m/src/state/hosts.ts` | `ServerPicker` | V | S | U (fake HTTP), M |
| SRC-08 | Root source pick | `App.tsx` | `SourcePick` state + `ui:source` | – | S | C |
| SRC-09/10 | applySourceContent / applySourcePosition | `c/sync/sourceContent.ts`, `sourceOrder.ts` | same | SQL | S | D, X |
| SRC-11 | sourceAccount cache | `m/src/state/account.ts` | same | V | S | U |
| IMP-01 | importCatalogue + adapters | `c/db/import*.ts`, `c/source/*` | `CatalogueImporter` on background dispatchers | V/SQL | L | U (parsers), D (import golden), M (timing) |
| IMP-02 | SetupOverlay + describeSetup | `m/src/ui/SetupOverlay.tsx`, `m/src/state/setup.ts` | Compose + same model | V | M | U (describeSetup table), C |
| IMP-03/04 | importSource flow | `m/src/state/app.tsx` | `ImportManager` | – | S | I |
| IMP-05 | renameChannels / reclassifyCategories | `c/db/channelNames.ts`, `categoryClassification.ts` | same, background | V | M | D |
| IMP-06 | keysFor | `c/db/storedKeys.ts` | same | V | S | D |
| IMP-07 | ensureMovieDetails / ensureSeriesEpisodes | `c/db/importVodDetails.ts` | same | V/SQL | M | D (fake provider) |
| SYNC-01 | controller timers + app hooks | `c/sync/syncController.ts`, `m/src/state/app.tsx` | `SyncController` (coroutine timers, lifecycle) | V | M | U (virtual time), M |
| SYNC-02..06 | collect/apply | `c/sync/localChanges.ts`, `channelHistory.ts`, `sourcePins.ts`, `hidden.ts` | same | V/SQL | L | X (TS↔Kotlin both directions), D |
| SYNC-07 | lastChangedAt poll | `m/src/state/app.tsx` | `StateFlow` from controller | – | S | U |
| SYNC-08 | Player pick-up | `m/src/screens/Player.tsx` | same rule | – | S | I, M |
| SYNC-09 | channelKeyFor (bug kept) | `c/sync/channelHistory.ts` | identical hash and input | V | S | U (incl. U+0001) |
| HOME-01 | StartScreen rows | `m/src/screens/Start.tsx`, `c/db/homeQueries.ts` | `HomeRepository` + Compose | SQL | L | D (row content/order), C |
| HOME-02 | Hero, NowNext | `m/src/screens/Home.tsx` | Compose Hero | – | M | C, M |
| HOME-03/04 | onSelect, heroActions, OptionsSheet | `m/src/screens/Start.tsx`, `channelActions.ts` | same action builders | – | M | C (action lists per row) |
| HOME-05 | Loading, persisted rows | `m/src/screens/Catalogue.tsx` | skeleton + cached rows | – | S | C, M (cold start) |
| HOME-06/07 | BackHandler, scroll snapping | `App.tsx`, `m/src/screens/Home.tsx` | `BringIntoViewSpec`, back handler | – | M | C, M |
| LIVE-01 | LiveScreen rows | `m/src/screens/Live.tsx` | Compose + repository | SQL | M | D, C |
| LIVE-02 | BrowseScreen pills | `m/src/screens/Browse.tsx` | Compose grid | SQL | M | D, C, M |
| LIVE-03..06 | zap list, hidden, monogram, order | Live/Browse/ChannelLogo | same | V/SQL | S | U (monogram, toneFor), D |
| EPG-01 | GuideScreen | `m/src/screens/Guide.tsx` | Compose guide | – | L | C, M |
| EPG-02/03 | airing.ts queues | `m/src/playback/airing.ts` | `GuideRepository` (latest-wins, limited parallelism) | V | M | U (fake clock/provider) |
| EPG-04/05 | guideImport.ts, importEpg, importGuideFile | `m/src/playback/guideImport.ts`, `c/epg/*` | `GuideImporter` (XmlPullParser, GZIPInputStream) | V/SQL | L | U (XMLTV vectors), D, M (timing) |
| EPG-06 | programme bar | `m/src/screens/Player.tsx` | same | – | S | I |
| EPG-07 | catchup | `m/src/playback/catchup.ts`, `c/source/xtream/catchup.ts`, `m/src/screens/player/format.ts` | same | V | M | U (timeshiftStamp, splitCatchup, entries), M |
| PLY-01 | resolveStream | `m/src/playback/resolveStream.ts` | same | V | S | U (URL vectors incl. odd passwords) |
| PLY-02..07 | usePlaybackHealth, feeds, copies | `m/src/screens/player/usePlaybackHealth.ts`, `c/db/channelFeeds.ts`, `vodQueries` | `PlaybackHealth` state machine | V/SQL | L | U (state machine, fake player), D (feeds, play order), M |
| PLY-08 | Failure, explain, plainReason, accountProblem | `m/src/screens/player/Failure.tsx`, `m/src/ui/plainReason.ts`, `m/src/state/account.ts` | same | V | M | U (message table) |
| PLY-09..14 | Playing controls and key handler | `m/src/screens/Player.tsx`, `player/keys.tsx` | Compose overlay + key reducer | – | L | U (key reducer: key sequence → state), C, M |
| PLY-15/16 | captions/audio | `m/src/playback/captions.ts`, `viewing.ts` | Media3 track selection + `CaptionStyleCompat` | V | M | U (autoCaptionTrack, speaks, nativeCaptionStyle), M |
| PLY-17/18 | fit/speed | `m/src/playback/viewing.ts` | `AspectRatioFrameLayout` resize modes, `playbackParameters` | V | S | U, M |
| PLY-19..21 | progress save, recents, next episode | `m/src/screens/Player.tsx`, `c/db/progressQueries.ts`, `seriesQueries.ts` | same | V/SQL | M | D, I |
| PLY-22..25 | load control, keep screen on, UA | expo-video | `DefaultLoadControl` same numbers, `keepScreenOn`, `Util.getUserAgent` | – | S | review, M |
| MOV-01 | MoviesScreen + movieHome | `m/src/screens/Catalogue.tsx`, `c/db/homeQueries.ts` | repository + Compose | SQL | M | D |
| MOV-02 | MoviesBrowse | `m/src/screens/Catalogue.tsx`, `Browse.tsx` | Compose | SQL/V | M | D, C |
| MOV-03 | MovieDetailScreen | `m/src/screens/MovieDetail.tsx` | Compose | – | M | C, M |
| MOV-04 | PosterCard | `m/src/ui/Poster.tsx` | Compose card, Coil | V (`sized`, `splitTitle`) | S | U, M (visual) |
| SER-01..02 | SeriesScreen/Browse | `m/src/screens/Catalogue.tsx` | Compose | SQL | M | D, C |
| SER-03..07 | SeriesDetailScreen + seriesQueries | `m/src/screens/SeriesDetail.tsx`, `c/db/seriesQueries.ts` | Compose + repository | V/SQL | L | D (up next, borrowed seasons), C, M |
| SRCH-01/02 | SearchScreen + searchAll | `m/src/screens/Search.tsx`, `c/db/searchQueries.ts` | Compose + FTS5 | SQL | M | D (same results and order), C |
| SET-01..04 | SourcesScreen panes | `m/src/screens/Sources.tsx`, `m/src/ui/CaptionSettings.tsx` | Compose | – | M | C, M |
| UPD-01..04 | update/*, InstallerModule.kt | `m/src/update/*`, `m/modules/testcard-installer` | `Updater` + reuse installer Kotlin | K | M | U (manifest parse, skip rule), M (real install) |
| TVUX-01..10 | App.tsx, Focusable, NavTab | `App.tsx`, `m/src/ui/*` | Compose shell, focus requesters | – | L | C (focus/back flows), M |
| ERR-01 | ErrorBoundary (unmounted) | `m/src/ui/ErrorBoundary.tsx` | uncaught-exception screen (see D1) | – | S | I |
| A11Y-01..05 | strings, theme, uiScale | `m/src/theme.ts` | Compose theme, same tokens | – | S | review |

## 12. Testing and parity strategy

### 12.1 Principle

The TypeScript implementation is the oracle. Anything that decides an id, a key, a wire byte, a URL or a
user-visible string is tested by **feeding the same input to both implementations and comparing outputs**. Kotlin
tests never hand-write expected values for those; they read them from vectors generated by the TS code.

### 12.2 Automated

| Layer | What | How |
| --- | --- | --- |
| Test vectors (new) | `packages/core/test-vectors/*.json`, generated by `packages/core/scripts/make-vectors.ts` from the real TS functions. They cover:<br>• `parseName`, `displayName`/`channelDisplayName`, `classifyCategory`, `groupVariants` ids<br>• `splitTitle`, `titleKey`, `dedupeTitles`, `genreOptions`, `classifyEntry`, `seriesKey`/`movieKey`<br>• `normalizeProviderHost`, all `remoteKeyFor*`, `channelKeyFor`, `pinHash`, `monogram`<br>• `timeshiftStamp`, `splitCatchup`, `shouldPromptResume`/`isWatched`<br>• `extractXtreamCredentials`, Xtream DTO mappers, `parseM3U` (fixture playlists), `parseXmltv` (fixture guides)<br>• `describeSetup`, `describeAccount`, `plainReason`/`explain`, `autoCaptionTrack`/`speaks`/`nativeCaptionStyle`, `sized`, `episodeTitle`/`seriesTitle`/`playerTitle`<br>• `qualityLabel`/`codecLabel`/`fpsLabel` | A vitest `vectors.test.ts` regenerates them in memory and fails if the committed files differ, so a TS change cannot silently drift from Kotlin. Inputs come from the existing fixtures (`categoryGolden.json`, test playlists) plus a list of awkward names: styled glyphs, NBSP, BOM, emoji, Turkish İ, `ß`, very long names, empty strings. |
| Crypto vectors | Fixed password/salt/IV, then derived key, ciphertext, blob and iv for credentials and profile payloads; link code, lookup and sealed secrets | Generated by TS with an injected IV. Kotlin must (a) produce identical bytes for the fixed IV and (b) decrypt TS output. |
| Kotlin JVM unit (`:core`) | Everything above, plus the key reducers (player keys, guide paging) and state machines (playback health, setup) | JUnit 5 reading vectors from `packages/core/test-vectors` via Gradle `test.resources.srcDir`. |
| DB golden | Same fixture catalogue imported by TS (better-sqlite3 under Electron-as-Node, per the repo's existing note) and by Kotlin (bundled SQLite on the JVM); then the same calls (`movieHome`, `browseChannels`, `searchAll`, `getSeriesDetail`, `listMoviePlayOrder`, `listChannelFeeds`, profile swap…) are compared as JSON | `packages/core/scripts/make-db-vectors.ts` writes `test-vectors/db/*.json`; Kotlin repository tests import the same fixture inputs and assert equality. |
| Cross-client sync (X) | A local Worker (`wrangler dev` with local D1, as `apps/sync-worker` tests already do) plus a TS client (core `SyncController` under Node) and the Kotlin `SyncController` on the JVM.<br>Scenarios: sign-up on TS → sign-in on Kotlin; sources with every optional field; profiles; favourites/recents/progress per profile; tombstones; deferral; pins/skips/hidden round-trip; 401 → re-auth; link approve. | Gradle task `:core:syncIntegrationTest` started by a script that boots the Worker; run in CI on demand and before each beta. |
| Compose UI tests | Focus order, Back stack, options sheets, PIN pad, player key reducer integration, empty/loading states | `androidx.compose.ui.test` with `performKeyInput` on an emulator (TV AVD) in CI. |
| Macrobenchmark | Cold start, Home scroll, Live browse, key latency | `androidx.benchmark.macro` module run on the TV emulator in CI (regression trend) and on the stick by hand (truth). Also generates the Baseline Profile. |
| StrictMode gate | Debug builds crash on disk or network access on the main thread | Turns "never block the UI thread" into a failing test whenever instrumented tests run. |

### 12.3 Integration flows (I)

Login (code and form), first sync to fully imported, refresh, add/edit/remove source, profile switch with sync,
playback of live/VOD/episode/catch-up, guide import (shared file and direct), update download and install. Each flow is
an instrumented test against fakes (OkHttp `MockWebServer` for providers and Worker) plus a manual device script.

### 12.4 End-to-end

- **Web and desktop:** the repository has **no Playwright today**. The only browser surface that matters here is the
  Worker's `/link` page, and its crypto contract is already held by `linkPageContract.test.ts`. Adding Playwright is
  optional. If wanted, one test drives `/link` in a browser against `wrangler dev` and asserts that the Kotlin TV client
  (JVM) receives the sign-in. The desktop app is unchanged by this migration, so no desktop E2E is required. Its sync
  is covered by the cross-client tests using the same core code it runs.
- **Android TV:** use Compose UI tests and UI Automator (key injection, cross-app installer dialog) on an Android TV
  emulator, plus the **manual device scripts** below on the real stick. Fire OS has no official automation beyond adb,
  so `adb shell input keyevent` scripts are the device-level E2E.

### 12.5 Manual device scripts (M)

One markdown checklist per area in `apps/tv-native/parity/` (e.g. `M-player.md`). Each step names the feature IDs
and is run on **both apps side by side** on the same stick and account: same action, compare outcome. Screenshots of
both are attached to the beta issue. Areas: sign-in, profiles, sources, home, live, guide, catch-up, player keys,
movies, series, search, settings, updates, offline, back and focus restoration.

### 12.6 Legacy parity rules

1. The current app wins. "Does the native implementation behave the same?" is answered by the side-by-side script, not
   by reading code.
2. Strings are copied verbatim (an `strings` check extracts user-visible strings from both and diffs them).
3. No redesigns, re-orders or "improvements" during migration. Ideas go into GitHub issues labelled `after-native`.
4. Every intended difference is listed below with its reason and needs the owner's sign-off before it ships.

### 12.7 Intentional-differences register (default: keep the current behaviour)

| # | Current behaviour | Proposed native behaviour | Why | Sign-off needed |
| --- | --- | --- | --- | --- |
| D1 | Render crash leaves a blank screen (ErrorBoundary unmounted) | Crash screen "Something went wrong" + Try again, as commit `00039e0` intended | Bug fix of documented intent | Yes |
| D2 | Media key: wait 450 ms for the media session, then toggle if it did not | Handle `KEYCODE_MEDIA_PLAY_PAUSE` directly; no media session | Same visible result; the workaround exists only because of expo-video | No (invisible) |
| D3 | Import pacing pauses imports while keys are pressed | No pacing; imports run in the background | Invisible; imports finish sooner | No |
| D4 | Every import (incl. manual Refresh) blocks the app behind the setup screen | **Keep** at parity | Product decision; could later become non-blocking | Only if changed |
| D5 | Launch catch-up holds the app up to 10 s | **Keep** | Product decision | Only if changed |
| D6 | Channel keys differ per device (SYNC-09) | **Keep identical algorithm** | Wire parity; fix separately in core first if wanted | Only if fixed |
| D7 | Caps: 600 per category, 300-channel zap list, 2,000 guide rows | **Keep** | Parity; can be lifted later cheaply in native | Only if changed |
| D8 | Backup excluded via expo-secure-store rules | `allowBackup=false` | Same effect for secrets; Fire OS has no app backup service | No |
