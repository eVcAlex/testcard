import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackHandler, Text, TVFocusGuideView, View } from "react-native";
import { useFonts } from "expo-font";
import { NavArrowDown, Search, Settings } from "iconoir-react-native";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useApp } from "./src/state/app";
import { useImportPacing } from "./src/platform/pacing";
import { UpdateProvider, useUpdate } from "./src/update/UpdateProvider";
import { colors, styleSheet, uiScale } from "./src/theme";
import { focusedNow, lastFocused } from "./src/ui/Focusable";
import { SourcePicker } from "./src/ui/SourcePicker";
import { BackToTop } from "./src/ui/backToTop";
import { NavTab } from "./src/ui/NavTab";
import { SetupOverlay } from "./src/ui/SetupOverlay";
import { SourceNames } from "./src/ui/Poster";
import { MoviesScreen, SeriesScreen } from "./src/screens/Catalogue";
import { LiveScreen } from "./src/screens/Live";
import { StartScreen } from "./src/screens/Start";
import { PlayerScreen } from "./src/screens/Player";
import { MovieDetailScreen } from "./src/screens/MovieDetail";
import { SeriesDetailScreen } from "./src/screens/SeriesDetail";
import { SignInScreen } from "./src/screens/SignIn";
import { SourcesScreen } from "./src/screens/Sources";
import { SearchScreen } from "./src/screens/Search";
import { WhoIsWatching } from "./src/screens/WhoIsWatching";
import { Avatar } from "./src/ui/Avatar";
import type { PlayItem } from "./src/playback/resolveStream";

type Section = "home" | "movies" | "series" | "live" | "search" | "sources";
type Route =
  | { name: "home" }
  | { name: "series"; id: string; title: string }
  | { name: "movie"; id: string; title: string }
  | { name: "play"; item: PlayItem; seriesId?: string; channels?: readonly PlayItem[] | undefined; resume: boolean; returnTo: Route };

/** A second back press within this long leaves the app. */
const EXIT_WINDOW_MS = 2500;

/** The places to go, after Search. Settings (sources, captions, the account, updates) is the gear at the far end, apart from them. */
const SECTIONS: { key: Section; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "live", label: "Live TV" },
  { key: "movies", label: "Movies" },
  { key: "series", label: "Series" },
];

/** Glyphs sized to sit in the nav bar's icon-only tabs. Icons take dp, not design units, so they are scaled like the styles. */
const NAV_GLYPH = Math.round(30 * uiScale);
function SearchGlyph(color: string) {
  return <Search color={color} width={NAV_GLYPH} height={NAV_GLYPH} strokeWidth={1.75} />;
}
function SettingsGlyph(color: string) {
  return <Settings color={color} width={NAV_GLYPH} height={NAV_GLYPH} strokeWidth={1.75} />;
}
const CHIP_ARROW = Math.round(22 * uiScale);
function ChipArrow(color: string) {
  return <NavArrowDown color={color} width={CHIP_ARROW} height={CHIP_ARROW} strokeWidth={2} />;
}

export default function App() {
  const [fontsReady] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  if (!fontsReady) return <View style={styles.shell} />;
  return (
    <AppProvider>
      <UpdateProvider>
        <StatusBar style="light" />
        <Root />
      </UpdateProvider>
    </AppProvider>
  );
}

function Root() {
  useImportPacing();
  const { status, sources, db, setup, syncing, profiles, profile } = useApp();
  const { available } = useUpdate();
  const [section, setSection] = useState<Section>("home");
  const [route, setRoute] = useState<Route>({ name: "home" });
  // The source every page shows: all of them, or one. One setting for the whole app (Home, Live TV, Movies, Series
  // and Search alike), kept across launches, and treated as All if that source is later removed.
  const [pickedSource, setPickedSource] = useState<string | null>(() => readSourcePick(db));
  const sourceId = pickedSource !== null && sources.some((entry) => entry.id === pickedSource) ? pickedSource : null;
  const [picking, setPicking] = useState(false);
  // Focus goes back to the Source button when the picker closes; it had focus when it was pressed.
  const pickerOpener = useRef<typeof lastFocused.current>(null);
  const openPicker = useCallback(() => {
    pickerOpener.current = lastFocused.current;
    setPicking(true);
  }, []);
  const closePicker = useCallback(() => {
    setPicking(false);
    setTimeout(() => pickerOpener.current?.requestTVFocus?.(), 0);
  }, []);
  const pickSource = useCallback(
    (id: string | null) => {
      setPickedSource(id);
      writeSourcePick(db, id);
      closePicker();
    },
    [db, closePicker],
  );

  // Movies and series may mix sources ("Source: All"); each poster then names its own.
  // Only when more than one source actually has films or series: a live-only source beside a VOD one would put the
  // same name on every poster.
  const sourceNames = useMemo(
    () => (sourceId === null && sources.filter((entry) => entry.movies + entry.series > 0).length > 1 ? new Map(sources.map((entry) => [entry.id, entry.name])) : null),
    [sourceId, sources],
  );

  // "Who's watching?": on launch when there is more than one profile, and from the profile button in the nav bar.
  const [choosing, setChoosing] = useState<"launch" | "switch" | null>(() => (profiles.length > 1 ? "launch" : null));
  const openProfiles = useCallback(() => setChoosing("switch"), []);
  const cancelProfiles = useCallback(() => setChoosing(null), []);
  // Another person's pages start from Home, drawn afresh from their own rows.
  const profileChosen = useCallback(() => {
    setChoosing(null);
    setRoute({ name: "home" });
    setSection("home");
    setVisited(new Set(["home"]));
    setBrowsing(false);
  }, []);

  const goHome = useCallback(() => setRoute({ name: "home" }), []);
  // Movies and Series open on a landing page of rows; "Browse all" in the nav bar swaps it for the full category list.
  const [browsing, setBrowsing] = useState<false | "categories" | "guide">(false);
  const [visited, setVisited] = useState<ReadonlySet<Section>>(() => new Set(["home"]));
  // Choosing Search opens the keyboard at once: a search page is only ever opened to type into.
  const [searchOpens, setSearchOpens] = useState(0);
  const pickSection = useCallback((key: string) => {
    if (key === "search") setSearchOpens((count) => count + 1);
    setSection(key as Section);
    setVisited((current) => (current.has(key as Section) ? current : new Set(current).add(key as Section)));
    setBrowsing(false);
  }, []);
  const onBrowse = useCallback(() => setBrowsing("categories"), []);
  const onGuide = useCallback(() => setBrowsing("guide"), []);
  const onBrowseDone = useCallback(() => setBrowsing(false), []);

  // Each tab's view, so Back can send focus to it; and whether the nav bar has focus at all.
  const tabHandles = useRef(new Map<string, typeof lastFocused>());
  const handleFor = (id: string) => {
    let handle = tabHandles.current.get(id);
    if (handle === undefined) {
      handle = { current: null };
      tabHandles.current.set(id, handle);
    }
    return handle;
  };
  const navFocused = useRef(false);
  const onNavFocus = useCallback((focused: boolean) => {
    navFocused.current = focused;
  }, []);
  const [backToTop, setBackToTop] = useState(0);

  // Back on a page goes up to the nav bar, onto the open section's tab, and the page starts again from its top, so
  // the bar is one press away however deep in the rows the viewer is. Back on the nav bar asks twice before leaving,
  // so a stray press does not close the app. Screens that use back themselves (the detail pages, the player, the
  // category list) are not the home shell, so they never get here.
  const [exitHint, setExitHint] = useState(false);
  const lastBack = useRef(0);
  const atRoot = route.name === "home" && !browsing;
  const sectionRef = useRef(section);
  sectionRef.current = section;
  useEffect(() => {
    if (!atRoot) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const tab = tabHandles.current.get(sectionRef.current)?.current;
      if (!navFocused.current && tab !== null && tab !== undefined) {
        tab.requestTVFocus?.();
        setBackToTop((count) => count + 1);
        return true;
      }
      const now = Date.now();
      if (now - lastBack.current < EXIT_WINDOW_MS) {
        BackHandler.exitApp();
        return true;
      }
      lastBack.current = now;
      setExitHint(true);
      return true;
    });
    return () => subscription.remove();
  }, [atRoot]);
  useEffect(() => {
    if (!exitHint) return;
    const timer = setTimeout(() => setExitHint(false), EXIT_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [exitHint]);

  // The player and detail pages cover the shell (see `overlay` below), and so does the getting-ready screen while a
  // source imports. Hiding it drops remote focus from it; on the way back, hand focus to what had it (the poster or
  // button that opened the page, the Refresh that was pressed), or the first key press lands on whatever is first on
  // screen instead.
  const settingUp = setup !== null && route.name === "home";
  const covered = route.name !== "home" || settingUp;
  const shellFocus = useRef<typeof lastFocused.current>(null);
  useLayoutEffect(() => {
    if (covered) {
      shellFocus.current = lastFocused.current;
      // The hidden bar reports no blur either.
      navFocused.current = false;
      return;
    }
    // Whatever held focus a moment ago was on the page that just closed (or in the hidden shell, which reports no
    // blur when it is hidden): it no longer counts as having focus.
    focusedNow.current = null;
    const target = shellFocus.current;
    if (target === null) return;
    // Asked again over a moment: the shell re-reads its rows as it comes back, and a request made mid-render can
    // be dropped. Stops once the target has focus, or once the viewer has moved it to something else.
    const timers = [0, 120, 300, 600].map((delay) =>
      setTimeout(() => {
        if (focusedNow.current !== null) return;
        target.requestTVFocus?.();
      }, delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [covered]);

  // Signed out (or the session ended): only the sign-in screen makes sense.
  if (status.account !== "signed-in") return <SignInScreen />;
  if (choosing !== null) return <WhoIsWatching onDone={profileChosen} onCancel={choosing === "switch" ? cancelProfiles : undefined} />;

  // The player and the detail pages cover the shell rather than replace it: the shell stays mounted underneath,
  // so Back returns to the same scroll position and highlighted poster instead of rebuilding Home from the top.
  const overlay: ReactNode =
    route.name === "play" ? (
      <PlayerScreen
        key={route.item.id}
        item={route.item}
        resume={route.resume}
        channels={route.channels}
        onZap={(next) => setRoute({ ...route, item: next })}
        onNextEpisode={(next) => setRoute({ ...route, item: next, resume: false })}
        onExit={() => setRoute(route.returnTo)}
        {...(route.seriesId !== undefined ? { seriesId: route.seriesId } : {})}
      />
    ) : route.name === "movie" ? (
      <MovieDetailScreen
        key={route.id}
        movieId={route.id}
        onBack={goHome}
        onOpenVersion={(movie) => setRoute({ name: "movie", id: movie.id, title: movie.title })}
        onPlay={(resume) => setRoute({ name: "play", item: { kind: "movie", id: route.id, title: route.title }, resume, returnTo: route })}
      />
    ) : route.name === "series" ? (
      <SeriesDetailScreen
        key={route.id}
        seriesId={route.id}
        title={route.title}
        onBack={goHome}
        onPlayEpisode={(episodeId, episodeTitle, resume) => setRoute({ name: "play", item: { kind: "episode", id: episodeId, title: episodeTitle }, seriesId: route.id, resume, returnTo: route })}
      />
    ) : null;

  const playChannel = (channel: { id: string; title: string }, channels: readonly { id: string; title: string }[]) =>
    setRoute({
      name: "play",
      item: { kind: "channel", id: channel.id, title: channel.title },
      channels: channels.map((entry) => ({ kind: "channel" as const, id: entry.id, title: entry.title })),
      resume: false,
      returnTo: { name: "home" },
    });
  const pane = (key: Section, node: ReactNode) =>
    visited.has(key) || section === key ? (
      <View key={key} style={section === key ? styles.content : styles.hidden}>
        {node}
      </View>
    ) : null;

  return (
    <SourceNames.Provider value={sourceNames}>
    <BackToTop.Provider value={backToTop}>
    {/* First sync or a refresh: the shell stays mounted but hidden, so there is nothing to navigate to until it
        finishes, and afterwards every section is where it was rather than rebuilt from the top. */}
    {settingUp ? <SetupOverlay setup={setup} hint={exitHint ? "Press back again to exit" : null} /> : overlay}
    <View style={covered ? styles.hidden : styles.shell}>
        <TVFocusGuideView autoFocus style={styles.nav}>
          <Text style={styles.brand}>
            test<Text style={styles.brandAccent}>card</Text>
          </Text>
          <NavTab id="search" preferred={section === "search"} active={section === "search"} icon={SearchGlyph} handle={handleFor("search")} onFocusChange={onNavFocus} onPressId={pickSection} />
          {SECTIONS.map((entry) => (
            <NavTab key={entry.key} id={entry.key} preferred={section === entry.key} active={section === entry.key} label={entry.label} handle={handleFor(entry.key)} onFocusChange={onNavFocus} onPressId={pickSection} />
          ))}
          {syncing ? <Text style={styles.syncing}>Syncing…</Text> : null}
          <View style={styles.scope}>
            {sources.length > 1 && section !== "sources" ? (
              <NavTab id="scope" chip active={picking} label={sources.find((entry) => entry.id === sourceId)?.name ?? "All sources"} trailing={ChipArrow} onFocusChange={onNavFocus} onPressId={openPicker} />
            ) : null}
            {profiles.length > 1 ? <NavTab id="profile" active={false} icon={() => <Avatar profile={profile} size={46} />} onFocusChange={onNavFocus} onPressId={openProfiles} /> : null}
            <NavTab id="sources" preferred={section === "sources"} active={section === "sources"} icon={SettingsGlyph} badge={available !== null} handle={handleFor("sources")} onFocusChange={onNavFocus} onPressId={pickSection} />
          </View>
        </TVFocusGuideView>
        <View style={styles.content}>
          {/* Each section is drawn the first time it is opened and kept, so coming back to it costs nothing and keeps its place. */}
          {pane(
            "home",
            <StartScreen
              sourceId={sourceId}
              active={section === "home" && !covered}
              onOpenMovie={(movie) => setRoute({ name: "movie", id: movie.id, title: movie.title })}
              onPlayMovie={(movie, resume) => setRoute({ name: "play", item: { kind: "movie", id: movie.id, title: movie.title }, resume, returnTo: { name: "home" } })}
              onOpenSeries={(series) => setRoute({ name: "series", id: series.id, title: series.title })}
              onPlayEpisode={(episodeId, title, resume, seriesId) => setRoute({ name: "play", item: { kind: "episode", id: episodeId, title }, seriesId, resume, returnTo: { name: "home" } })}
              onPlayChannel={playChannel}
            />,
          )}
          {pane(
            "movies",
            <MoviesScreen
              sourceId={sourceId}
              active={section === "movies" && !covered}
              browsing={browsing === "categories" && section === "movies"}
              onBrowse={onBrowse}
              onBrowseDone={onBrowseDone}
              onOpen={(movie) => setRoute({ name: "movie", id: movie.id, title: movie.title })}
              onPlay={(movie, resume) => setRoute({ name: "play", item: { kind: "movie", id: movie.id, title: movie.title }, resume, returnTo: { name: "home" } })}
            />,
          )}
          {pane(
            "series",
            <SeriesScreen
              sourceId={sourceId}
              active={section === "series" && !covered}
              browsing={browsing === "categories" && section === "series"}
              onBrowse={onBrowse}
              onBrowseDone={onBrowseDone}
              onOpen={(series) => setRoute({ name: "series", id: series.id, title: series.title })}
              onPlayEpisode={(episodeId, title, resume, seriesId) => setRoute({ name: "play", item: { kind: "episode", id: episodeId, title }, seriesId, resume, returnTo: { name: "home" } })}
            />,
          )}
          {pane("live", <LiveScreen sourceId={sourceId} active={section === "live" && !covered} browsing={browsing === "categories" && section === "live"} guide={browsing === "guide" && section === "live"} onBrowse={onBrowse} onGuide={onGuide} onBrowseDone={onBrowseDone} onPlay={playChannel} />)}
          {pane(
            "search",
            <View style={styles.padded}>
              <SearchScreen
                sourceId={sourceId}
                openKeyboard={searchOpens}
                onOpenMovie={(movie) => setRoute({ name: "movie", id: movie.id, title: movie.title })}
                onOpenSeries={(series) => setRoute({ name: "series", id: series.id, title: series.title })}
                onPlayChannel={playChannel}
              />
            </View>,
          )}
          {pane(
            "sources",
            <View style={styles.padded}>
              <SourcesScreen />
            </View>,
          )}
        </View>
        {picking ? <SourcePicker sources={sources} picked={sourceId} onPick={pickSource} onClose={closePicker} /> : null}
        {exitHint && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>Press back again to exit</Text>
          </View>
        )}
    </View>
    </BackToTop.Provider>
    </SourceNames.Provider>
  );
}

/** Where the source pick is kept between launches: this device's own setting, not synced. */
const SOURCE_PICK_KEY = "ui:source";

function readSourcePick(db: ReturnType<typeof useApp>["db"]): string | null {
  try {
    const row = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(SOURCE_PICK_KEY) as { value: string } | undefined;
    return row === undefined || row.value === "" ? null : row.value;
  } catch {
    return null;
  }
}

function writeSourcePick(db: ReturnType<typeof useApp>["db"], sourceId: string | null): void {
  try {
    db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(SOURCE_PICK_KEY, sourceId ?? "");
  } catch {
    // Only the next launch would miss it.
  }
}

const styles = styleSheet({
  shell: { flex: 1, backgroundColor: colors.background },
  // The nav bar floats over the page so the Movies and Series art can run behind it; other screens start below it.
  nav: { position: "absolute", left: 0, right: 0, top: 0, zIndex: 10, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 44, paddingTop: 28, paddingBottom: 12 },
  brand: { color: colors.foreground, fontSize: 30, fontWeight: "600", letterSpacing: -0.5, marginRight: 40 },
  brandAccent: { color: colors.accent },
  syncing: { color: colors.faint, fontSize: 22, marginLeft: 16 },
  scope: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12 },
  content: { flex: 1 },
  hidden: { display: "none" },
  toast: { position: "absolute", left: 0, right: 0, bottom: 60, alignItems: "center", zIndex: 20 },
  toastText: { color: colors.foreground, fontSize: 26, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 999, backgroundColor: "#000000d9", overflow: "hidden" },
  padded: { flex: 1, paddingHorizontal: 44, paddingTop: 112 },
});
