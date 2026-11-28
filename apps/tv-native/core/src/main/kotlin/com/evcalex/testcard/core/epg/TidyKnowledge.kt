package com.evcalex.testcard.core.epg

/**
* What "Tidy playlist" knows about channels by their names, for any provider (`tidyKnowledge.ts`): which league a channel belongs to, which
* network's local station it is, and which names are only placeholders. `LEAGUES` and `NETWORKS` are copied from the TypeScript
* tables; `test-vectors/tidyFacets.json` pins the answers, so the two cannot drift.
*/

/** A league, sport or competition a channel's (or its category's) name can say it belongs to. */
class League(val key: String, val label: String, val emoji: String, val pattern: String, val countries: List<String>? = null)

/** In the order the rail lists them: the big leagues first. A channel can belong to more than one. */
val LEAGUES: List<League> = listOf(
    League("skysports", "Sky Sports", "📺", """sky ?sports\b""", listOf("UK", "IE")),
    League("skychannels", "Sky Channels", "📺", """\bsky\b(?!\s*sports?\b)""", listOf("UK", "IE")),
    League("tnt", "TNT Sports / BT Sport", "📺", """tnt ?sports?\b|\bBT ?sports?\b|\bBT box office\b""", listOf("UK", "IE")),
    League("spfl", "Scottish Football", "⚽", """\bSPFL\b|scottish (?:premiership|football|championship|cup)|\bcinch\b|viaplay scot""", listOf("UK", "IE")),
    League("efl", "EFL", "⚽", """\bEFL\b|carabao|sky bet (?:championship|league)""", listOf("UK")),
    League("dazn", "DAZN", "📺", """\bDAZN\b"""),
    League("espn", "ESPN", "📺", """\bESPN\b"""),
    League("bein", "beIN Sports", "📺", """\bbe ?in ?sports?\b"""),
    League("eurosport", "Eurosport", "📺", """eurosport"""),
    League("premiersports", "Premier Sports", "📺", """premier sports""", listOf("UK", "IE")),
    League("nfl", "NFL", "🏈", """\bNFL\b|sunday ticket|redzone|(?:sunday|monday|thursday) night football"""),
    League("ncaaf", "College Football", "🏟️", """\bNCAAF\b|college football|\bCFB\b"""),
    League("nba", "NBA", "🏀", """\bNBA\b"""),
    League("wnba", "WNBA", "🏀", """\bWNBA\b"""),
    League("ncaab", "College Basketball", "🏟️", """\bNCAAB\b|college basketball|march madness"""),
    League("mlb", "MLB", "⚾", """\bMLB\b"""),
    League("milb", "MiLB", "⚾", """\bMILB\b"""),
    League("nhl", "NHL", "🏒", """\bNHL\b|center ice"""),
    League("mls", "MLS", "⚽", """\bMLS\b"""),
    League("epl", "Premier League", "⚽", """\bEPL\b|premier league"""),
    League("laliga", "La Liga", "⚽", """la ?liga"""),
    League("seriea", "Serie A", "⚽", """serie a\b"""),
    League("bundesliga", "Bundesliga", "⚽", """bundesliga"""),
    League("ligue1", "Ligue 1", "⚽", """ligue 1\b"""),
    League("uefa", "UEFA", "⚽", """\bUEFA\b|champions league|europa league|conference league"""),
    League("f1", "Formula 1", "🏎️", """\bF1\b|formula ?(?:1|one)\b"""),
    League("motorsport", "Motorsport", "🏎️", """nascar|indycar|motogp|\bMXGP\b|supercross|dirtvision|\bTT races\b|\brally\b"""),
    League("ufc", "UFC", "🥊", """\bUFC\b"""),
    League("boxing", "Boxing", "🥊", """boxing|matchroom|\bPBC\b"""),
    League("wrestling", "Wrestling", "🤼", """\bWWE\b|\bAEW\b|wrestling"""),
    League("tennis", "Tennis", "🎾", """tennis|\bATP\b|\bWTA\b|wimbledon|roland garros"""),
    League("golf", "Golf", "⛳", """\bgolf\b|\bPGA\b|\bLIV golf\b"""),
    League("cricket", "Cricket", "🏏", """cricket|\bIPL\b|\bBBL\b"""),
    League("rugby", "Rugby", "🏉", """rugby|six nations|\bNRL\b"""),
    League("afl", "AFL", "🏉", """\bAFL\b"""),
    League("darts", "Darts", "🎯", """\bPDC\b|\bdarts\b"""),
    League("highschool", "High School Sports", "🏫", """\bNFHS\b|high school"""),
)

/** A broadcast network whose local stations a provider lists ("NBC 5 (WMAQ) Chicago"). */
class Network(val key: String, val label: String, val pattern: String)

val NETWORKS: List<Network> = listOf(
    Network("nbc", "NBC", """\bNBC\b"""),
    Network("abc", "ABC", """\bABC\b"""),
    Network("cbs", "CBS", """\bCBS\b"""),
    Network("fox", "FOX", """\bFOX\b"""),
    Network("cw", "CW", """\bCW\b"""),
    Network("pbs", "PBS", """\bPBS\b"""),
    Network("telemundo", "Telemundo", """telemundo"""),
    Network("univision", "Univision", """univision"""),
)

/** The order a broadcaster's stations are known in (`STATION_ORDER` in `tidyKnowledge.ts`): flagship channels first, then the numbered ones. */
val STATION_ORDER: Map<String, List<String>> = mapOf(
    "skysports" to listOf("main event", "premier league", """sports?\s+1\b""", """sports?\s+2\b""", """sports?\s+3\b""", """sports?\s+4\b""", """sports?\s+5\b""", "football", "cricket", "golf", "f1|formula", "action", "arena", "mix", "news", "racing"),
    "tnt" to listOf("""sports?\s+1\b""", """sports?\s+2\b""", """sports?\s+3\b""", """sports?\s+4\b""", "ultimate", "box office"),
)
private val ORDER_PATTERNS = STATION_ORDER.mapValues { (_, sources) -> sources.map { Regex(it, RegexOption.IGNORE_CASE) } }

/** Where a station comes in its list (`stationRank`): its place in [STATION_ORDER] for the list's broadcaster, after all of them if none, 0 for a list with no order. */
fun stationRank(listKey: String, name: String): Int {
    val patterns = ORDER_PATTERNS[listKey] ?: return 0
    val at = patterns.indexOfFirst { it.containsMatchIn(name) }
    return if (at < 0) patterns.size else at
}

private val LEAGUE_PATTERNS = LEAGUES.map { it to Regex(it.pattern, RegexOption.IGNORE_CASE) }
private val NETWORK_PATTERNS = NETWORKS.map { it to Regex(it.pattern, RegexOption.IGNORE_CASE) }

/** The leagues a name (a channel's, or its category's) says it belongs to, by key, in [LEAGUES] order. */
fun leaguesOf(text: String): List<String> = LEAGUE_PATTERNS.filter { (_, regex) -> regex.containsMatchIn(text) }.map { (league, _) -> league.key }

/** A provider's own prefix ("MXC| ", "UK: "): the channel says which market it is. */
private val PREFIXED = Regex("""^\s*[^\s|:]{1,6}\s*[|:]""")

/** The leagues and broadcasters a channel belongs to (`leaguesOfChannel` in `tidyKnowledge.ts`); a one-market broadcaster only for that country's channels. */
fun leaguesOfChannel(rawName: String, categoryRaw: String, country: String?): List<String> {
    val named = leaguesOf("$rawName $categoryRaw").toSet()
    return LEAGUES.filter { league ->
        when {
            league.key !in named -> false
            league.countries == null -> true
            country != null -> country in league.countries
            else -> !PREFIXED.containsMatchIn(rawName)
        }
    }.map { it.key }
}

private val SKY_SPORT_SINGULAR = Regex("""\bsky ?sport\b""", RegexOption.IGNORE_CASE)

/** A pay broadcaster's channel (`isBroadcasterChannel`): it has its own list, so the national "TV Guide" leaves it out. */
fun isBroadcasterChannel(rawName: String, country: String?): Boolean {
    if (SKY_SPORT_SINGULAR.containsMatchIn(rawName)) return true
    return leaguesOfChannel(rawName, "", country).any { key -> LEAGUES.firstOrNull { it.key == key }?.countries != null }
}

/** "(WMAQ)", "(KGO)", "(Wtvd)": a U.S. station's call letters in brackets. */
private val CALL_SIGN = Regex("""(?:\(|\[)\s*[KW][A-Za-z]{2,3}(?:-?(?:TV|DT|HD|LD))?\s*(?:\)|\])""")
/** "[Chicago]", "[Santa Barbara]": a city in square brackets (not a three-letter tag like "[NBC]"). */
private val BRACKET_CITY = Regex("""\[\s*[A-Za-z][A-Za-z .'-]{3,}\s*\]""")
/** "WILKES BARRE, PA WBRE NBC 28": a city, a state and call letters before the network. */
private val CITY_STATE = Regex(""",\s*[A-Z]{2}\s+[KW][A-Z]{2,3}\b""")
private fun networkNumber(network: String) = Regex("""\b$network\s+\d{1,2}\b""", RegexOption.IGNORE_CASE)
/** A network's own national services and shows, not a local station ("FOX News", "NBC Sports", "ABC News Live"). */
private fun nationalService(network: String) = Regex("""\b$network\s+(?:sports?|news|business|weather|universo|soul|movies?|nation|now|kids|deportes|latino|bet|golf|nascar)\b""", RegexOption.IGNORE_CASE)

/**
 * The network whose local station a channel is (by key), or null: a network name with a station's call letters, a city in square brackets,
 * a "city, ST CALL" lead or a channel number; a network's national services do not count.
 */
fun localNetworkOf(name: String): String? {
    for ((network, regex) in NETWORK_PATTERNS) {
        if (!regex.containsMatchIn(name)) continue
        if (CALL_SIGN.containsMatchIn(name) || BRACKET_CITY.containsMatchIn(name) || CITY_STATE.containsMatchIn(name)) return network.key
        if (nationalService(network.label).containsMatchIn(name)) continue
        if (networkNumber(network.label).containsMatchIn(name)) return network.key
    }
    return null
}

private val PLACEHOLDER = Regex("""\bno (?:game|games|event|events|match|matches|fixture|fixtures|stream|streams|scheduled)\b|\bnot (?:live|streaming)\b|\bno event streaming\b|\bevent offline\b""", RegexOption.IGNORE_CASE)
/** "##### NCAAF #####": a divider row the provider puts between groups, not a channel. */
private val DIVIDER = Regex("""^[\s\W]*[#=*~_-]{3,}""")

/** A channel that is not a station: an event slot with nothing on, or a divider row. Left out of the tidy lists. */
fun isPlaceholderChannelName(name: String): Boolean = PLACEHOLDER.containsMatchIn(name) || DIVIDER.containsMatchIn(name)

/** The label of a league's list in the rail: "🏈 NFL". */
fun leagueListLabel(league: League): String = "${league.emoji} ${league.label}"

/** The label of a network's local stations list in the rail: "📺 NBC local stations". */
fun localListLabel(network: Network): String = "📺 ${network.label} local stations"
