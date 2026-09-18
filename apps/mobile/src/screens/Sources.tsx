import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../state/app";
import { colors, space, type } from "../theme";
import { Button, Heading, Muted } from "../ui/controls";

/** What this device has loaded from each source, with a manual refresh. Sources themselves are managed on the computer. */
export function SourcesScreen() {
  const { sources, refreshSource, status, sync, updateStatus } = useApp();

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Heading>Sources</Heading>
      <Muted>
        {status.account === "signed-in"
          ? `Signed in as ${status.email ?? "your account"}. Add or edit sources in Testcard on your computer; they appear here.`
          : "Sign in to load your sources."}
      </Muted>
      {status.lastError !== undefined && <Text style={styles.error}>{status.lastError}</Text>}

      {sources.length === 0 && <Muted>No sources have arrived yet. Sync runs every minute, or press Sync now.</Muted>}
      {sources.map((source) => (
        <View key={source.id} style={styles.card}>
          <View style={styles.cardText}>
            <Text style={styles.name}>{source.name}</Text>
            <Text style={styles.meta}>
              {source.refreshing
                ? "Loading..."
                : `${source.channels.toLocaleString()} channels, ${source.movies.toLocaleString()} movies, ${source.series.toLocaleString()} series`}
            </Text>
            {source.error !== undefined && <Text style={styles.error}>{source.error}</Text>}
          </View>
          <Button label={source.refreshing ? "Refreshing" : "Refresh"} disabled={source.refreshing} onPress={() => void refreshSource(source.id)} />
        </View>
      ))}

      <View style={styles.actions}>
        <Button
          label="Sync now"
          onPress={() => {
            void sync.triggerNow().then(updateStatus);
          }}
        />
        <Button
          label="Sign out"
          onPress={() => {
            void sync.signOut().then(updateStatus);
          }}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.xl, gap: space.l },
  card: { flexDirection: "row", alignItems: "center", gap: space.l, padding: space.l, backgroundColor: colors.card, borderRadius: 12 },
  cardText: { flex: 1, gap: 4 },
  name: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: type.body },
  error: { color: colors.fault, fontSize: type.small },
  actions: { flexDirection: "row", gap: space.m, marginTop: space.m },
});
