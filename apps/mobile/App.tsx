import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useApp } from "./src/state/app";
import { UpdateProvider, useUpdate } from "./src/update/UpdateProvider";
import { colors, space, type } from "./src/theme";
import { Focusable } from "./src/ui/Focusable";
import { MoviesScreen, SeriesScreen } from "./src/screens/Catalogue";
import { LiveScreen } from "./src/screens/Live";
import { PlayerScreen } from "./src/screens/Player";
import { SeriesDetailScreen } from "./src/screens/SeriesDetail";
import { SignInScreen } from "./src/screens/SignIn";
import { SourcesScreen } from "./src/screens/Sources";
import type { PlayItem } from "./src/playback/resolveStream";

type Section = "movies" | "series" | "live" | "sources";
type Route =
  | { name: "home" }
  | { name: "series"; id: string; title: string }
  | { name: "play"; item: PlayItem; seriesId?: string; resume: boolean; returnTo: Route };

const SECTIONS: { key: Section; label: string }[] = [
  { key: "movies", label: "Movies" },
  { key: "series", label: "Series" },
  { key: "live", label: "Live TV" },
  { key: "sources", label: "Sources" },
];

export default function App() {
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
  const [section, setSection] = useState<Section>("movies");
  const [route, setRoute] = useState<Route>({ name: "home" });

  const goHome = useCallback(() => setRoute({ name: "home" }), []);

  // Signed out (or the session ended): only the sign-in screen makes sense.
  if (status.account !== "signed-in") return <SignInScreen />;

  if (route.name === "play") {
    return <PlayerScreen item={route.item} resume={route.resume} onExit={() => setRoute(route.returnTo)} {...(route.seriesId !== undefined ? { seriesId: route.seriesId } : {})} />;
  }
  if (route.name === "series") {
    return (
      <SeriesDetailScreen
        seriesId={route.id}
        title={route.title}
        onBack={goHome}
        onPlay={(episode) =>
          setRoute({ name: "play", item: { kind: "episode", id: episode.id, title: episode.title }, seriesId: episode.seriesId, resume: episode.resume, returnTo: route })
        }
      />
    );
  }

  return (
    <View style={styles.shell}>
        <View style={styles.rail}>
          <Text style={styles.brand}>
            TEST<Text style={styles.brandAccent}>CARD</Text>
          </Text>
          {SECTIONS.map((entry, index) => (
            <Focusable key={entry.key} preferred={index === 0} onPress={() => setSection(entry.key)} style={[styles.railItem, section === entry.key && styles.railItemActive]}>
              <Text style={[styles.railLabel, section === entry.key && styles.railLabelActive]}>{entry.key === "sources" && available !== null ? `${entry.label} (update)` : entry.label}</Text>
            </Focusable>
          ))}
        </View>
        <View style={styles.content}>
          {section === "movies" && (
            <MoviesScreen
              onPlay={(movie) => setRoute({ name: "play", item: { kind: "movie", id: movie.id, title: movie.title }, resume: movie.resume, returnTo: { name: "home" } })}
            />
          )}
          {section === "series" && <SeriesScreen onOpen={(series) => setRoute({ name: "series", id: series.id, title: series.title })} />}
          {section === "live" && (
            <LiveScreen onPlay={(channel) => setRoute({ name: "play", item: { kind: "channel", id: channel.id, title: channel.title }, resume: false, returnTo: { name: "home" } })} />
          )}
          {section === "sources" && <SourcesScreen />}
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: colors.background },
  rail: { width: 260, backgroundColor: colors.raised, padding: space.l, gap: space.s, borderRightWidth: 1, borderRightColor: colors.border },
  brand: { color: colors.foreground, fontSize: type.lead, fontWeight: "700", marginBottom: space.l },
  brandAccent: { color: colors.accent },
  railItem: { paddingVertical: space.m, paddingHorizontal: space.l },
  railItemActive: { backgroundColor: colors.accentSoft },
  railLabel: { color: colors.muted, fontSize: type.body, fontWeight: "500" },
  railLabelActive: { color: colors.accent },
  content: { flex: 1, paddingLeft: space.l },
});
