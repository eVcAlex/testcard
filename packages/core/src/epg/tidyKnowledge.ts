// What "Tidy playlist" knows about channels by their names, for any provider: which league a channel belongs to, which network's
// local station it is, and which names are only placeholders. Pure data and functions, so both apps reproduce them exactly
// (the Kotlin port is generated from `LEAGUES` and `NETWORKS`, and `test-vectors/tidyFacets.json` pins the answers).

/** A league, sport or competition a channel's (or its category's) name can say it belongs to. */
export interface League {
  readonly key: string;
  readonly label: string;
  readonly emoji: string;
  /** A regular expression source, matched case-insensitively against the name. Kept to what Java's regex reads the same. */
  readonly pattern: string;
  /** Only this country's channels (a UK broadcaster's name also turns up on other markets' copies); absent: any country. */
  readonly countries?: readonly string[];
}

/** In the order the rail lists them: the big leagues first. A channel can belong to more than one. */
export const LEAGUES: readonly League[] = [
  { key: "skysports", label: "Sky Sports", emoji: "📺", pattern: "sky ?sports\\b", countries: ["UK", "IE"] },
  { key: "skychannels", label: "Sky Channels", emoji: "📺", pattern: "\\bsky\\b(?!\\s*sports?\\b)", countries: ["UK", "IE"] },
  { key: "tnt", label: "TNT Sports / BT Sport", emoji: "📺", pattern: "tnt ?sports?\\b|\\bBT ?sports?\\b|\\bBT box office\\b", countries: ["UK", "IE"] },
  { key: "spfl", label: "Scottish Football", emoji: "⚽", pattern: "\\bSPFL\\b|scottish (?:premiership|football|championship|cup)|\\bcinch\\b|viaplay scot", countries: ["UK", "IE"] },
  { key: "efl", label: "EFL", emoji: "⚽", pattern: "\\bEFL\\b|carabao|sky bet (?:championship|league)", countries: ["UK"] },
  { key: "dazn", label: "DAZN", emoji: "📺", pattern: "\\bDAZN\\b" },
  { key: "espn", label: "ESPN", emoji: "📺", pattern: "\\bESPN\\b" },
  { key: "bein", label: "beIN Sports", emoji: "📺", pattern: "\\bbe ?in ?sports?\\b" },
  { key: "eurosport", label: "Eurosport", emoji: "📺", pattern: "eurosport" },
  { key: "premiersports", label: "Premier Sports", emoji: "📺", pattern: "premier sports", countries: ["UK", "IE"] },
  { key: "nfl", label: "NFL", emoji: "🏈", pattern: "\\bNFL\\b|sunday ticket|redzone|(?:sunday|monday|thursday) night football" },
  { key: "ncaaf", label: "College Football", emoji: "🏟️", pattern: "\\bNCAAF\\b|college football|\\bCFB\\b" },
  { key: "nba", label: "NBA", emoji: "🏀", pattern: "\\bNBA\\b" },
  { key: "wnba", label: "WNBA", emoji: "🏀", pattern: "\\bWNBA\\b" },
  { key: "ncaab", label: "College Basketball", emoji: "🏟️", pattern: "\\bNCAAB\\b|college basketball|march madness" },
  { key: "mlb", label: "MLB", emoji: "⚾", pattern: "\\bMLB\\b" },
  { key: "milb", label: "MiLB", emoji: "⚾", pattern: "\\bMILB\\b" },
  { key: "nhl", label: "NHL", emoji: "🏒", pattern: "\\bNHL\\b|center ice" },
  { key: "mls", label: "MLS", emoji: "⚽", pattern: "\\bMLS\\b" },
  { key: "epl", label: "Premier League", emoji: "⚽", pattern: "\\bEPL\\b|premier league" },
  { key: "laliga", label: "La Liga", emoji: "⚽", pattern: "la ?liga" },
  { key: "seriea", label: "Serie A", emoji: "⚽", pattern: "serie a\\b" },
  { key: "bundesliga", label: "Bundesliga", emoji: "⚽", pattern: "bundesliga" },
  { key: "ligue1", label: "Ligue 1", emoji: "⚽", pattern: "ligue 1\\b" },
  { key: "uefa", label: "UEFA", emoji: "⚽", pattern: "\\bUEFA\\b|champions league|europa league|conference league" },
  { key: "f1", label: "Formula 1", emoji: "🏎️", pattern: "\\bF1\\b|formula ?(?:1|one)\\b" },
  { key: "motorsport", label: "Motorsport", emoji: "🏎️", pattern: "nascar|indycar|motogp|\\bMXGP\\b|supercross|dirtvision|\\bTT races\\b|\\brally\\b" },
  { key: "ufc", label: "UFC", emoji: "🥊", pattern: "\\bUFC\\b" },
  { key: "boxing", label: "Boxing", emoji: "🥊", pattern: "boxing|matchroom|\\bPBC\\b" },
  { key: "wrestling", label: "Wrestling", emoji: "🤼", pattern: "\\bWWE\\b|\\bAEW\\b|wrestling" },
  { key: "tennis", label: "Tennis", emoji: "🎾", pattern: "tennis|\\bATP\\b|\\bWTA\\b|wimbledon|roland garros" },
  { key: "golf", label: "Golf", emoji: "⛳", pattern: "\\bgolf\\b|\\bPGA\\b|\\bLIV golf\\b" },
  { key: "cricket", label: "Cricket", emoji: "🏏", pattern: "cricket|\\bIPL\\b|\\bBBL\\b" },
  { key: "rugby", label: "Rugby", emoji: "🏉", pattern: "rugby|six nations|\\bNRL\\b" },
  { key: "afl", label: "AFL", emoji: "🏉", pattern: "\\bAFL\\b" },
  { key: "darts", label: "Darts", emoji: "🎯", pattern: "\\bPDC\\b|\\bdarts\\b" },
  { key: "highschool", label: "High School Sports", emoji: "🏫", pattern: "\\bNFHS\\b|high school" },
];

/** A broadcast network whose local stations a provider lists ("NBC 5 (WMAQ) Chicago"). */
export interface Network {
  readonly key: string;
  readonly label: string;
  readonly pattern: string;
}

export const NETWORKS: readonly Network[] = [
  { key: "nbc", label: "NBC", pattern: "\\bNBC\\b" },
  { key: "abc", label: "ABC", pattern: "\\bABC\\b" },
  { key: "cbs", label: "CBS", pattern: "\\bCBS\\b" },
  { key: "fox", label: "FOX", pattern: "\\bFOX\\b" },
  { key: "cw", label: "CW", pattern: "\\bCW\\b" },
  { key: "pbs", label: "PBS", pattern: "\\bPBS\\b" },
  { key: "telemundo", label: "Telemundo", pattern: "telemundo" },
  { key: "univision", label: "Univision", pattern: "univision" },
];

/**
 * The order a broadcaster's stations are known in, as regular expression sources: its flagship channels first, then the numbered ones,
 * then the rest in the provider's order ("Main Event", "Premier League", "Sports 1", "Sports 2" ...). Only for the broadcasters listed.
 */
export const STATION_ORDER: Readonly<Record<string, readonly string[]>> = {
  skysports: ["main event", "premier league", "sports?\\s+1\\b", "sports?\\s+2\\b", "sports?\\s+3\\b", "sports?\\s+4\\b", "sports?\\s+5\\b", "football", "cricket", "golf", "f1|formula", "action", "arena", "mix", "news", "racing"],
  tnt: ["sports?\\s+1\\b", "sports?\\s+2\\b", "sports?\\s+3\\b", "sports?\\s+4\\b", "ultimate", "box office"],
};
const ORDER_PATTERNS = Object.fromEntries(Object.entries(STATION_ORDER).map(([key, sources]) => [key, sources.map((source) => new RegExp(source, "i"))]));

/** Where a station comes in its list: its place in `STATION_ORDER` for the list's broadcaster, or after all of them (0 for a list with no order). */
export function stationRank(listKey: string, name: string): number {
  const patterns = ORDER_PATTERNS[listKey];
  if (patterns === undefined) return 0;
  const at = patterns.findIndex((pattern) => pattern.test(name));
  return at < 0 ? patterns.length : at;
}

const compile = (source: string) => new RegExp(source, "i");
const LEAGUE_PATTERNS = LEAGUES.map((league) => ({ league, regex: compile(league.pattern) }));
const NETWORK_PATTERNS = NETWORKS.map((network) => ({ network, regex: compile(network.pattern) }));

/** The leagues a name (a channel's, or its category's) says it belongs to, by key, in `LEAGUES` order. */
export function leaguesOf(text: string): string[] {
  return LEAGUE_PATTERNS.filter(({ regex }) => regex.test(text)).map(({ league }) => league.key);
}

/** A provider's own prefix ("MXC| ", "UK: "): the channel says which market it is. */
const PREFIXED = /^\s*[^\s|:]{1,6}\s*[|:]/;

/**
 * The leagues and broadcasters a channel belongs to, by key: what its name and its category's say, and, for a broadcaster of one market
 * ("Sky Sports"), only the channels of that country (or, with no country and no prefix, unmarked ones): "MXC| Sky Sports 1" is Mexico's.
 */
export function leaguesOfChannel(rawName: string, categoryRaw: string, country: string | null): string[] {
  const named = new Set(leaguesOf(`${rawName} ${categoryRaw}`));
  return LEAGUES.filter((league) => {
    if (!named.has(league.key)) return false;
    if (league.countries === undefined) return true;
    return country !== null ? league.countries.includes(country) : !PREFIXED.test(rawName);
  }).map((league) => league.key);
}

/** A pay broadcaster's channel (Sky, TNT, BT...): it has its own list, so the national "TV Guide" leaves it out. */
export function isBroadcasterChannel(rawName: string, country: string | null): boolean {
  if (/\bsky ?sport\b/i.test(rawName)) return true;
  return leaguesOfChannel(rawName, "", country).some((key) => LEAGUES.find((league) => league.key === key)?.countries !== undefined);
}

/** "(WMAQ)", "(KGO)", "(Wtvd)": a U.S. station's call letters in brackets. */
const CALL_SIGN = /(?:\(|\[)\s*[KW][A-Za-z]{2,3}(?:-?(?:TV|DT|HD|LD))?\s*(?:\)|\])/;
/** "[Chicago]", "[Santa Barbara]": a city in square brackets (not a three-letter tag like "[NBC]"). */
const BRACKET_CITY = /\[\s*[A-Za-z][A-Za-z .'-]{3,}\s*\]/;
/** "WILKES BARRE, PA WBRE NBC 28": a city, a state and call letters before the network. */
const CITY_STATE = /,\s*[A-Z]{2}\s+[KW][A-Z]{2,3}\b/;
/** The network followed by a channel number ("NBC 5", "ABC 13"). */
const NETWORK_NUMBER = (network: string) => new RegExp(`\\b${network}\\s+\\d{1,2}\\b`, "i");
/** A network's own national services and shows, not a local station ("FOX News", "NBC Sports", "ABC News Live"). */
const NATIONAL_SERVICE = (network: string) => new RegExp(`\\b${network}\\s+(?:sports?|news|business|weather|universo|soul|movies?|nation|now|kids|deportes|latino|bet|golf|nascar)\\b`, "i");

/**
 * The network whose local station a channel is (by key), or null. A network name with a station's call letters, a city in square
 * brackets, a "city, ST CALL" lead or a channel number counts; a network's national services ("FOX News", "NBC Sports") do not.
 */
export function localNetworkOf(name: string): string | null {
  for (const { network, regex } of NETWORK_PATTERNS) {
    if (!regex.test(name)) continue;
    const upper = network.label;
    const strongSign = CALL_SIGN.test(name) || BRACKET_CITY.test(name) || CITY_STATE.test(name);
    if (strongSign) return network.key;
    if (NATIONAL_SERVICE(upper).test(name)) continue;
    if (NETWORK_NUMBER(upper).test(name)) return network.key;
  }
  return null;
}

const PLACEHOLDER = /\bno (?:game|games|event|events|match|matches|fixture|fixtures|stream|streams|scheduled)\b|\bnot (?:live|streaming)\b|\bno event streaming\b|\bevent offline\b/i;

/** "##### NCAAF #####", "======= UEFA PPV =======": a divider row the provider puts between groups, not a channel. */
const DIVIDER = /^[\s\W]*[#=*~_-]{3,}/;

/**
 * A channel that is not a station: an event slot with nothing on ("NHL 01: No Game Today", "- NO EVENT STREAMING -"), or a divider row
 * ("##### NCAAF #####"). Left out of the tidy lists.
 */
export function isPlaceholderChannelName(name: string): boolean {
  return PLACEHOLDER.test(name) || DIVIDER.test(name);
}

/** The label of a league's list in the rail: "🏈 NFL". */
export function leagueListLabel(league: League): string {
  return `${league.emoji} ${league.label}`;
}

/** The label of a network's local stations list in the rail: "📺 NBC local stations". */
export function localListLabel(network: Network): string {
  return `📺 ${network.label} local stations`;
}
