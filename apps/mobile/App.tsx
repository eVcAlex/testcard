import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackHandler, Text, TVFocusGuideView, View } from "react-native";
import { useFonts } from "expo-font";
import { Search } from "iconoir-react-native";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useApp } from "./src/state/app";
import { UpdateProvider, useUpdate } from "./src/update/UpdateProvider";
import { colors, styleSheet } from "./src/theme";
import { focusedNow, lastFocused } from "./src/ui/Focusable";
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
import type { PlayItem } from "./src/playback/resolveStream";

type Section = "home" | "movies" | "series" | "live" | "search" | "sources";
type Route =
  | { name: "home" }
  | { name: "series"; id: string; title: string }
  | { name: "movie"; id: string; title: string }
  | { name: "play"; item: PlayItem; seriesId?: string; channels?: readonly PlayItem[] | undefined; resume: boolean; returnTo: Route };

/** A second back press within this long leaves the app. */
const EXIT_WINDOW_MS = 2500;

const SECTIONS: { key: Section; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "live", label: "Live TV" },
  { key: "movies", label: "Movies" },
  { key: "series", label: "Series" },
  { key: "sources", label: "Sources" },
];

/** A bare magnifying glass, sized to sit in the nav bar's icon-only tab. */
function SearchGlyph(color: string) {
  return <Search color={color} width={28} height={28} strokeWidth={1.75} />;
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
  const { status, sources, db, version, setup } = useApp();
  const { available } = useUpdate();
  const [section, setSection] = useState<Section>("home");
  const [route, setRoute] = useState<Route>({ name: "home" });
  // Which source the browse screens show: all of them, or one. Forgotten if that source is later removed.
  const [pickedSource, setPickedSource] = useState<string | null>(null);
  const sourceId = pickedSource !== null && sources.some((entry) => entry.id === pickedSource) ? pickedSource : null;
  const cycleSource = useCallback(() => {
    const ids = [null, ...sources.map((entry) => entry.id)];
    setPickedSource(ids[(ids.indexOf(sourceId) + 1) % ids.length] ?? null);
  }, [sourceId, sources]);

  // Live TV shows one source at a time, never all together: its own pick, among the sources that have channels.
  const liveSources = useMemo(() => {
    void version;
    const withChannels = new Set((db.prepare("SELECT DISTINCT source_id AS id FROM channels").all() as { id: string }[]).map((row) => row.id));
    return sources.filter((entry) => withChannels.has(entry.id));
  }, [db, version, sources]);
  const [pickedLive, setPickedLive] = useState<string | null>(null);
  const liveSource = liveSources.find((entry) => entry.id === pickedLive) ?? liveSources[0] ?? null;
  const cycleLive = useCallback(() => {
    const at = liveSources.findIndex((entry) => entry.id === liveSource?.id);
    setPickedLive(liveSources[(at + 1) % liveSources.length]?.id ?? null);
  }, [liveSource, liveSources]);

  // Movies and series may mix sources ("Source: All"); each poster then names its own.
  const sourceNames = useMemo(() => (sourceId === null && sources.length > 1 ? new Map(sources.map((entry) => [entry.id, entry.name])) : null), [sourceId, sources]);

  const goHome = useCallback(() => setRoute({ name: "home" }), []);
  // Movies and Series open on a landing page of rows; "Browse all" in the nav bar swaps it for the full category list.
  const [browsing, setBrowsing] = useState(false);
  const [visited, setVisited] = useState<ReadonlySet<Section>>(() => new Set(["home"]));
  const pickSection = useCallback((key: string) => {
    setSection(key as Section);
    setVisited((current) => (current.has(key as Section) ? current : new Set(current).add(key as Section)));
    setBrowsing(false);
  }, []);
  const toggleBrowse = useCallback(() => setBrowsing((value) => !value), []);
  const onBrowseDone = useCallback(() => setBrowsing(false), []);

  // Back on the main screens asks twice before leaving, so a stray press does not close the app. Screens that use
  // back themselves (the detail pages, the player, the browse-all list) are not the home shell, so they never get here.
  const [exitHint, setExitHint] = useState(false);
  const lastBack = useRef(0);
  const atRoot = route.name === "home" && !browsing;
  useEffect(() => {
    if (!atRoot) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
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
    {/* First sync or a refresh: the shell stays mounted but hidden, so there is nothing to navigate to until it
        finishes, and afterwards every section is where it was rather than rebuilt from the top. */}
    {settingUp ? <SetupOverlay setup={setup} hint={exitHint ? "Press back again to exit" : null} /> : overlay}
    <View style={covered ? styles.hidden : styles.shell}>
        <TVFocusGuideView autoFocus style={styles.nav}>
          <Text style={styles.brand}>
            test<Text style={styles.brandAccent}>card</Text>
          </Text>
          {SECTIONS.map((entry) => (
            <NavTab key={entry.key} id={entry.key} preferred={section === entry.key} active={section === entry.key} label={entry.label} badge={entry.key === "sources" && available !== null} onPressId={pickSection} />
          ))}
          <View style={styles.scope}>
            {section === "movies" || section === "series" || section === "live" ? <NavTab id="browse" active={browsing} label={browsing ? "Home" : "Browse all"} onPressId={toggleBrowse} /> : null}
            {section === "live" && liveSources.length > 1 ? <NavTab id="scope" active={false} label={`Source: ${liveSource?.name ?? ""}`} onPressId={cycleLive} /> : null}
            {section !== "live" && sources.length > 1 && section !== "sources" ? <NavTab id="scope" active={false} label={`Source: ${sources.find((entry) => entry.id === sourceId)?.name ?? "All"}`} onPressId={cycleSource} /> : null}
            <NavTab id="search" active={section === "search"} icon={SearchGlyph} onPressId={pickSection} />
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
              browsing={browsing && section === "movies"}
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
              browsing={browsing && section === "series"}
              onBrowseDone={onBrowseDone}
              onOpen={(series) => setRoute({ name: "series", id: series.id, title: series.title })}
              onPlayEpisode={(episodeId, title, resume, seriesId) => setRoute({ name: "play", item: { kind: "episode", id: episodeId, title }, seriesId, resume, returnTo: { name: "home" } })}
            />,
          )}
          {pane("live", <LiveScreen sourceId={liveSource?.id ?? null} active={section === "live" && !covered} browsing={browsing && section === "live"} onBrowseDone={onBrowseDone} onPlay={playChannel} />)}
          {pane(
            "search",
            <View style={styles.padded}>
              <SearchScreen
                sourceId={sourceId}
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
        {exitHint && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>Press back again to exit</Text>
          </View>
        )}
    </View>
    </SourceNames.Provider>
  );
}

const styles = styleSheet({
  shell: { flex: 1, backgroundColor: colors.background },
  // The nav bar floats over the page so the Movies and Series art can run behind it; other screens start below it.
  nav: { position: "absolute", left: 0, right: 0, top: 0, zIndex: 10, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 44, paddingTop: 28, paddingBottom: 12 },
  brand: { color: colors.foreground, fontSize: 30, fontWeight: "600", letterSpacing: -0.5, marginRight: 40 },
  brandAccent: { color: colors.accent },
  scope: { flex: 1, flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  content: { flex: 1 },
  hidden: { display: "none" },
  toast: { position: "absolute", left: 0, right: 0, bottom: 60, alignItems: "center", zIndex: 20 },
  toastText: { color: colors.foreground, fontSize: 26, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 999, backgroundColor: "#000000d9", overflow: "hidden" },
  padded: { flex: 1, paddingHorizontal: 44, paddingTop: 112 },
});
