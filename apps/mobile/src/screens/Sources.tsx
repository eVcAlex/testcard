import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useApp } from "../state/app";
import { useUpdate } from "../update/UpdateProvider";
import { installedVersion } from "../update/update";
import { colors, space, type, styleSheet } from "../theme";
import { Button, Heading, Muted } from "../ui/controls";
import { withCommas } from "../ui/MenuRow";

/** "just now", "5 min ago", "3 hours ago", "2 days ago". */
function ago(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** What this device has loaded from each source, with a manual refresh. Sources themselves are managed on the computer. */
export function SourcesScreen() {
  const { sources, refreshSource, removeSource, status, sync, updateStatus } = useApp();
  // Removing is permanent (and reaches the other devices), so it takes a second press.
  const [confirming, setConfirming] = useState<string>();
  const update = useUpdate();
  const version = installedVersion();

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.main}>
        <Heading>Sources</Heading>
        <Muted>
          {status.account === "signed-in"
            ? "Add or edit sources in Testcard on your computer and they appear here. Removing one here removes it everywhere."
            : "Sign in to load your sources."}
        </Muted>
        {status.lastError !== undefined && <Text style={styles.error}>{status.lastError}</Text>}

        {sources.length === 0 && <Muted>No sources have arrived yet. Sync runs every minute, or press Sync now.</Muted>}
        {sources.map((source) => (
          <View key={source.id} style={styles.card}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{source.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.cardText}>
              <Text style={styles.name} numberOfLines={1}>
                {source.name}
                <Text style={styles.kind}>{source.kind === "xtream" ? "  Xtream" : "  M3U"}</Text>
              </Text>
              <Text style={styles.meta}>{source.refreshing ? "Loading..." : counts(source.channels, source.movies, source.series)}</Text>
              {source.error !== undefined ? (
                <Text style={styles.error}>{source.error}</Text>
              ) : source.lastRefreshedAt !== null ? (
                <Text style={styles.synced}>{`Synced ${ago(source.lastRefreshedAt)}`}</Text>
              ) : null}
            </View>
            <Button label={source.refreshing ? "Refreshing" : "Refresh"} disabled={source.refreshing} onPress={() => void refreshSource(source.id)} />
            <Button
              label={confirming === source.id ? "Press again to remove" : "Remove"}
              onPress={() => {
                if (confirming === source.id) {
                  setConfirming(undefined);
                  void removeSource(source.id);
                } else setConfirming(source.id);
              }}
            />
          </View>
        ))}
      </View>

      <View style={styles.side}>
        <View style={styles.panel}>
          <Text style={styles.name}>{`Testcard ${version.name}`}</Text>
          <Text style={styles.meta}>
            {!update.configured
              ? "Updates are not set up for this build."
              : update.phase === "downloading"
                ? `Downloading ${Math.round(update.progress * 100)}%`
                : update.phase === "checking"
                  ? "Checking for updates..."
                  : update.available !== null
                    ? `Version ${update.available.versionName} is available.`
                    : update.checked
                      ? "You are up to date."
                      : "Not checked yet."}
          </Text>
          {update.error !== undefined && <Text style={styles.error}>{update.error}</Text>}
          {update.configured && (
            <Button
              primary={update.available !== null}
              label={update.available !== null ? "Update now" : "Check for updates"}
              disabled={update.phase === "downloading" || update.phase === "checking"}
              onPress={update.available !== null ? update.install : update.check}
            />
          )}
        </View>

        <View style={styles.panel}>
          <Text style={styles.name}>Account</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {status.email ?? "Signed out"}
          </Text>
          {status.lastSyncedAt !== undefined && <Text style={styles.synced}>{`Synced ${ago(status.lastSyncedAt)}`}</Text>}
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
        </View>
      </View>
    </ScrollView>
  );
}

/** Only the kinds of content a source actually has: a live-only provider does not say "0 movies". */
function counts(channels: number, movies: number, series: number): string {
  const parts = [
    channels > 0 ? `${withCommas(channels)} channels` : null,
    movies > 0 ? `${withCommas(movies)} movies` : null,
    series > 0 ? `${withCommas(series)} series` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : "Nothing loaded yet";
}

const styles = styleSheet({
  page: { flexDirection: "row", alignItems: "flex-start", gap: space.xl, padding: space.xl },
  main: { flex: 1, gap: space.l },
  side: { width: 520, gap: space.l, paddingTop: 84 },
  card: { flexDirection: "row", alignItems: "center", gap: space.l, padding: space.l, backgroundColor: colors.raised, borderRadius: 18 },
  avatar: { width: 84, height: 84, borderRadius: 20, backgroundColor: colors.cardActive, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.accent, fontSize: 34, fontWeight: "600" },
  cardText: { flex: 1, gap: 4 },
  panel: { gap: space.m, padding: space.l, backgroundColor: colors.raised, borderRadius: 18 },
  name: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
  kind: { color: colors.faint, fontSize: type.small, fontWeight: "400" },
  meta: { color: colors.muted, fontSize: type.body },
  synced: { color: colors.accent, fontSize: type.small },
  error: { color: colors.fault, fontSize: type.small },
  actions: { flexDirection: "row", gap: space.m },
});
