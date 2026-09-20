import { useCallback, useState } from "react";
import { Text, TVFocusGuideView, View } from "react-native";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useApp } from "./src/state/app";
import { UpdateProvider, useUpdate } from "./src/update/UpdateProvider";
import { colors, space, type, styleSheet } from "./src/theme";
import { NavTab } from "./src/ui/NavTab";
import { MoviesScreen, SeriesScreen } from "./src/screens/Catalogue";
import { LiveScreen } from "./src/screens/Live";
import { PlayerScreen } from "./src/screens/Player";
import { MovieDetailScreen } from "./src/screens/MovieDetail";
import { SeriesDetailScreen } from "./src/screens/SeriesDetail";
import { EpisodeDetailScreen } from "./src/screens/EpisodeDetail";
import { SignInScreen } from "./src/screens/SignIn";
import { SourcesScreen } from "./src/screens/Sources";
import type { PlayItem } from "./src/playback/resolveStream";

type Section = "movies" | "series" | "live" | "sources";
type Route =
  | { name: "home" }
  | { name: "series"; id: string; title: string }
  | { name: "movie"; id: string; title: string }
  | { name: "episode"; id: string; title: string; seriesId: string; seriesTitle: string }
  | { name: "play"; item: PlayItem; seriesId?: string; channels?: readonly PlayItem[] | undefined; resume: boolean; returnTo: Route };

const SECTIONS: { key: Section; label: string }[] = [
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
  const { status } = useApp();
  const { available } = useUpdate();
  const [section, setSection] = useState<Section>("live");
  const [route, setRoute] = useState<Route>({ name: "home" });

  const goHome = useCallback(() => setRoute({ name: "home" }), []);
  const pickSection = useCallback((key: string) => setSection(key as Section), []);

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

  return (
    <View style={styles.shell}>
        <TVFocusGuideView autoFocus style={styles.nav}>
          <Text style={styles.brand}>
            test<Text style={styles.brandAccent}>card</Text>
          </Text>
          {SECTIONS.map((entry) => (
            <NavTab key={entry.key} id={entry.key} preferred={section === entry.key} active={section === entry.key} label={entry.label} badge={entry.key === "sources" && available !== null} onPressId={pickSection} />
          ))}
        </TVFocusGuideView>
        <View style={styles.content}>
          {section === "movies" && (
            <MoviesScreen onOpen={(movie) => setRoute({ name: "movie", id: movie.id, title: movie.title })} />
          )}
          {section === "series" && <SeriesScreen onOpen={(series) => setRoute({ name: "series", id: series.id, title: series.title })} />}
          {section === "live" && (
            <LiveScreen
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
          {section === "sources" && <SourcesScreen />}
        </View>
    </View>
  );
}

const styles = styleSheet({
  shell: { flex: 1, backgroundColor: colors.background },
  nav: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 44, paddingTop: 28, paddingBottom: 12 },
  brand: { color: colors.foreground, fontSize: 30, fontWeight: "600", letterSpacing: -0.5, marginRight: 40 },
  brandAccent: { color: colors.accent },
  content: { flex: 1, paddingHorizontal: 44, paddingTop: 12 },
});
