package com.evcalex.testcard.core.setup

/** Where one source's import has got to (`state/setup.ts`): live, movies, series, then a sync brings the history. */
enum class ImportStage { Live, Movies, Series, Saving, History, Done }

enum class ContentKind(val label: String) {
    Live("Live channels"),
    Movies("Movies"),
    Series("Series"),
}

class Wants(val live: Boolean, val movies: Boolean, val series: Boolean) {
    fun of(kind: ContentKind) = when (kind) {
        ContentKind.Live -> live
        ContentKind.Movies -> movies
        ContentKind.Series -> series
    }
}

class ImportProgress(
    val name: String,
    /** The kinds of content this source is set to import. */
    val wants: Wants,
    /** What the source is known to hold; null when that is not known yet (a playlist on its first load). */
    val shows: List<ContentKind>?,
    val at: ImportStage,
)

enum class StepState { Done, Active, Waiting }

class SetupStep(val key: String, val label: String, val note: String?, val state: StepState)

/** What the "getting ready" screen shows. */
class SetupProgress(val steps: List<SetupStep>, /** 0 to 1. */ val fraction: Double, val detail: String)

private fun doingOf(stage: ImportStage) = when (stage) {
    ImportStage.Live -> "loading live channels"
    ImportStage.Movies -> "loading movies"
    ImportStage.Series -> "loading series"
    ImportStage.Saving -> "finishing up"
    ImportStage.History -> "syncing watch history"
    ImportStage.Done -> "finishing up"
}

private fun sourceFraction(entry: ImportProgress): Double {
    if (entry.at == ImportStage.History || entry.at == ImportStage.Done) return 1.0
    val stages = ContentKind.entries.filter { entry.wants.of(it) }.map { stageOf(it) } + ImportStage.Saving
    return (maxOf(0, stages.indexOf(entry.at)) + 0.5) / stages.size
}

private fun stageOf(kind: ContentKind) = when (kind) {
    ContentKind.Live -> ImportStage.Live
    ContentKind.Movies -> ImportStage.Movies
    ContentKind.Series -> ImportStage.Series
}

private fun kindOf(stage: ImportStage) = when (stage) {
    ImportStage.Live -> ContentKind.Live
    ImportStage.Movies -> ContentKind.Movies
    ImportStage.Series -> ContentKind.Series
    else -> null
}

/**
 * The "getting ready" screen: null unless `firstSync` is true, which it is while a signed-in device is waiting for its
 * first sync to bring its sources in, or while any source is importing. `launchSync` is the catch-up with the account on
 * every launch: the same screen, with only the watch history to wait for. Each importing source gets its own step,
 * described by what it holds; a source that has finished stays ticked until the others are done too.
 */
fun describeSetup(firstSync: Boolean, launchSync: Boolean = false, imports: List<ImportProgress>): SetupProgress? {
    if (!firstSync) {
        if (!launchSync) return null
        return SetupProgress(
            listOf(
                SetupStep("account", "Account secured", null, StepState.Done),
                SetupStep("sources", "Your sources", null, StepState.Done),
                SetupStep("history", "Watch history", "From your other devices", StepState.Active),
            ),
            0.8,
            "Syncing watch history and favourites",
        )
    }
    val sourceSteps = imports.mapIndexed { index, entry ->
        SetupStep(
            "source$index",
            entry.name,
            entry.shows.let { shows -> if (shows == null) "Playlist" else if (shows.isNotEmpty()) shows.joinToString(" · ") { it.label } else "Nothing to load" },
            if (entry.at == ImportStage.History || entry.at == ImportStage.Done) StepState.Done else StepState.Active,
        )
    }
    val allDone = imports.isNotEmpty() && imports.all { it.at == ImportStage.Done }
    val historyState = if (allDone) StepState.Done else if (imports.any { it.at == ImportStage.History }) StepState.Active else StepState.Waiting
    val steps = listOf(
        SetupStep("account", "Account secured", null, StepState.Done),
        SetupStep("sources", "Your sources", null, if (imports.isNotEmpty()) StepState.Done else StepState.Active),
    ) + sourceSteps + SetupStep("history", "Watch history", null, historyState)
    val score = 1.0 + (if (imports.isNotEmpty()) 1.0 else 0.5) + imports.sumOf { sourceFraction(it) } +
        (if (historyState == StepState.Done) 1.0 else if (historyState == StepState.Active) 0.5 else 0.0)
    val current = imports.firstOrNull { it.at != ImportStage.Done }
    // Said in the step's terms: a live-only playlist passes through the film and series stages and should not claim to be
    // loading films; a playlist on its first load is one download, whatever it holds.
    fun doing(entry: ImportProgress): String {
        val kind = kindOf(entry.at)
        if (kind != null) {
            if (entry.shows == null) return "loading the playlist"
            if (kind !in entry.shows) return doingOf(ImportStage.Saving)
        }
        return doingOf(entry.at)
    }
    return SetupProgress(
        steps,
        minOf(1.0, score / steps.size),
        if (current == null) { if (imports.isEmpty()) "Fetching your sources" else "Almost there" } else "${current.name}: ${doing(current)}",
    )
}
