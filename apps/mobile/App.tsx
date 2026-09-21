import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Text, TVFocusGuideView, View } from "react-native";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useApp } from "./src/state/app";
import { UpdateProvider, useUpdate } from "./src/update/UpdateProvider";
import { colors, space, type, styleSheet } from "./src/theme";
import { NavTab } from "./src/ui/NavTab";
import { SetupOverlay } from "./src/ui/SetupOverlay";
import { SourceNames } from "./src/ui/Poster";
import { MoviesScreen, SeriesScreen } from "./src/screens/Catalogue";
import { LiveScreen } from "./src/screens/Live";
import { StartScreen } from "./src/screens/Start";
import { PlayerScreen } from "./src/screens/Player";
import { MovieDetailScreen } from "./src/screens/MovieDetail";
import { SeriesDetailScreen } from "./src/screens/SeriesDetail";
import { EpisodeDetailScreen } from "./src/screens/EpisodeDetail";
import { SignInScreen } from "./src/screens/SignIn";
import { SourcesScreen } from "./src/screens/Sources";
import { SearchScreen } from "./src/screens/Search";
import type { PlayItem } from "./src/playback/resolveStream";

type Section = "home" | "movies" | "series" | "live" | "search" | "sources";
type Route =
  | { name: "home" }
  | { name: "series"; id: string; title: string }
  | { name: "movie"; id: string; title: string }
  | { name: "episode"; id: string; title: string; seriesId: string; seriesTitle: string }
  | { name: "play"; item: PlayItem; seriesId?: string; channels?: readonly PlayItem[] | undefined; resume: boolean; returnTo: Route };

/** A second back press within this long leaves the app. */
const EXIT_WINDOW_MS = 2500;

const SECTIONS: { key: Section; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "search", label: "Search" },
  { key: "live", label: "Live TV" },
  { key: "movies", label: "Movies" },
  { key: "series", label: "Series" },
  { key: "sources", label: "Sources" },
];

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
  const pickSection = useCallback((key: string) => {
    setSection(key as Section);
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

  // Signed out (or the session ended): only the sign-in screen makes sense.
  if (status.account !== "signed-in") return <SignInScreen />;

  if (route.name === "play") {
    return (
      <PlayerScreen
        key={route.item.id}
        item={route.item}
        resume={route.resume}
        channels={route.channels}
        onZap={(next) => setRoute({ ...route, item: next })}
        onExit={() => setRoute(route.returnTo)}
        {...(route.seriesId !== undefined ? { seriesId: route.seriesId } : {})}
      />
    );
  }
  if (route.name === "movie") {
    return (
      <MovieDetailScreen
        movieId={route.id}
        onBack={goHome}
        onPlay={(resume) => setRoute({ name: "play", item: { kind: "movie", id: route.id, title: route.title }, resume, returnTo: route })}
      />
    );
  }
  if (route.name === "series") {
    return (
      <SeriesDetailScreen
        seriesId={route.id}
        title={route.title}
        onBack={goHome}
        onOpenEpisode={(episodeId, episodeTitle) => setRoute({ name: "episode", id: episodeId, title: episodeTitle, seriesId: route.id, seriesTitle: route.title })}
        onPlayEpisode={(episodeId, episodeTitle, resume) => setRoute({ name: "play", item: { kind: "episode", id: episodeId, title: episodeTitle }, seriesId: route.id, resume, returnTo: route })}
      />
    );
  }
  if (route.name === "episode") {
    return (
      <EpisodeDetailScreen
        seriesId={route.seriesId}
        episodeId={route.id}
        onBack={() => setRoute({ name: "series", id: route.seriesId, title: route.seriesTitle })}
        onPlay={(resume) => setRoute({ name: "play", item: { kind: "episode", id: route.id, title: route.title }, seriesId: route.seriesId, resume, returnTo: route })}
      />
    );
  }

  // First sync or a refresh: nothing else is drawn, so there is nothing to navigate to until it finishes.
  if (setup !== null) return <SetupOverlay setup={setup} hint={exitHint ? "Press back again to exit" : null} />;

  return (
    <SourceNames.Provider value={sourceNames}>
    <View style={styles.shell}>
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
          </View>
        </TVFocusGuideView>
        <View style={styles.content}>
          {section === "home" && (
            <StartScreen
              sourceId={sourceId}
              onOpenMovie={(movie) => setRoute({ name: "movie", id: movie.id, title: movie.title })}
              onPlayMovie={(movie, resume) => setRoute({ name: "play", item: { kind: "movie", id: movie.id, title: movie.title }, resume, returnTo: { name: "home" } })}
              onOpenSeries={(series) => setRoute({ name: "series", id: series.id, title: series.title })}
              onPlayChannel={(channel, channels) =>
                setRoute({
                  name: "play",
                  item: { kind: "channel", id: channel.id, title: channel.title },
                  channels: channels.map((entry) => ({ kind: "channel" as const, id: entry.id, title: entry.title })),
                  resume: false,
                  returnTo: { name: "home" },
                })
              }
            />
          )}
          {section === "movies" && (
            <MoviesScreen
              sourceId={sourceId}
              browsing={browsing}
              onBrowseDone={onBrowseDone}
              onOpen={(movie) => setRoute({ name: "movie", id: movie.id, title: movie.title })}
              onPlay={(movie, resume) => setRoute({ name: "play", item: { kind: "movie", id: movie.id, title: movie.title }, resume, returnTo: { name: "home" } })}
            />
          )}
          {section === "series" && <SeriesScreen sourceId={sourceId} browsing={browsing} onBrowseDone={onBrowseDone} onOpen={(series) => setRoute({ name: "series", id: series.id, title: series.title })} />}
          {section === "live" && (
            <LiveScreen
              sourceId={liveSource?.id ?? null}
              browsing={browsing}
              onBrowseDone={onBrowseDone}
              onPlay={(channel, channels) =>
                setRoute({
                  name: "play",
                  item: { kind: "channel", id: channel.id, title: channel.title },
                  channels: channels.map((entry) => ({ kind: "channel" as const, id: entry.id, title: entry.title })),
                  resume: false,
                  returnTo: { name: "home" },
                })
              }
            />
          )}
          {section === "search" && (
            <View style={styles.padded}>
              <SearchScreen
                sourceId={sourceId}
                onOpenMovie={(movie) => setRoute({ name: "movie", id: movie.id, title: movie.title })}
                onOpenSeries={(series) => setRoute({ name: "series", id: series.id, title: series.title })}
                onPlayChannel={(channel, channels) =>
                  setRoute({
                    name: "play",
                    item: { kind: "channel", id: channel.id, title: channel.title },
                    channels: channels.map((entry) => ({ kind: "channel" as const, id: entry.id, title: entry.title })),
                    resume: false,
                    returnTo: { name: "home" },
                  })
                }
              />
            </View>
          )}
          {section === "sources" && (
            <View style={styles.padded}>
              <SourcesScreen />
            </View>
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
  toast: { position: "absolute", left: 0, right: 0, bottom: 60, alignItems: "center", zIndex: 20 },
  toastText: { color: colors.foreground, fontSize: 26, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 999, backgroundColor: "#000000d9", overflow: "hidden" },
  padded: { flex: 1, paddingHorizontal: 44, paddingTop: 112 },
});
