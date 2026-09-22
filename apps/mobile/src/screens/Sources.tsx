import { useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { useApp } from "../state/app";
import { useUpdate } from "../update/UpdateProvider";
import { installedVersion } from "../update/update";
import { colors, space, type, styleSheet } from "../theme";
import { Button, Heading, Muted } from "../ui/controls";
import { Focusable } from "../ui/Focusable";
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

/**
 * Sources, with the account and app update as a slim strip and footer either side — this page is about the
 * sources, not the account, so those two stay out of the way instead of competing with the sources for weight.
 */
export function SourcesScreen() {
  const { sources, refreshSource, removeSource, status, sync, updateStatus } = useApp();
  // Removing is permanent (and reaches the other devices), so it takes a second press.
  const [confirming, setConfirming] = useState<string>();
  // Signing out drops the account from this TV, and the button sits right beside Sync now, so it asks first.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const update = useUpdate();
  const version = installedVersion();

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.main}>
        <View style={styles.accountStrip}>
          <View style={styles.accountText}>
            <Text style={styles.accountEmail} numberOfLines={1}>
              {status.email ?? "Signed out"}
            </Text>
            {status.lastSyncedAt !== undefined && <Text style={styles.accountSynced}>{`✓ Synced ${ago(status.lastSyncedAt)}`}</Text>}
          </View>
          <View style={styles.accountActions}>
            <SmallButton
              label="Sync now"
              onPress={() => {
                void sync.triggerNow().then(updateStatus);
              }}
            />
            <SmallButton label="Sign out" onPress={() => setConfirmingSignOut(true)} />
          </View>
        </View>

        <Heading>Sources</Heading>
        <Muted>
          {status.account === "signed-in"
            ? "Add or edit sources in Testcard on your computer and they appear here. Removing one here removes it everywhere."
            : "Sign in to load your sources."}
        </Muted>
        {status.lastError !== undefined && <Text style={styles.error}>{status.lastError}</Text>}
        {sources.length === 0 && <Muted>No sources have arrived yet. Sync runs every minute, or press Sync now above.</Muted>}

        <View style={styles.list}>
          {sources.map((source) => (
            <View key={source.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {source.name}
                  <Text style={styles.rowKind}>{`   ${source.kind === "xtream" ? "Xtream" : "M3U"}`}</Text>
                </Text>
                <Text style={styles.rowMeta}>{source.refreshing ? "Loading..." : counts(source.channels, source.movies, source.series)}</Text>
              </View>
              <View style={styles.rowStatus}>
                {source.error !== undefined ? (
                  <Text style={styles.error} numberOfLines={1}>
                    {source.error}
                  </Text>
                ) : source.lastRefreshedAt !== null ? (
                  <Text style={styles.rowSynced}>{`✓ Synced ${ago(source.lastRefreshedAt)}`}</Text>
                ) : null}
              </View>
              <View style={styles.rowActions}>
                <SmallButton label={source.refreshing ? "Refreshing" : "Refresh"} disabled={source.refreshing} onPress={() => void refreshSource(source.id)} />
                <SmallButton
                  muted
                  label={confirming === source.id ? "Press again to remove" : "Remove"}
                  onPress={() => {
                    if (confirming === source.id) {
                      setConfirming(undefined);
                      void removeSource(source.id);
                    } else setConfirming(source.id);
                  }}
                />
              </View>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {`Testcard ${version.name}`}
            <Text style={styles.footerDot}>{"  ·  "}</Text>
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
            <SmallButton
              primary={update.available !== null}
              label={update.available !== null ? "Update now" : "Check for updates"}
              disabled={update.phase === "downloading" || update.phase === "checking"}
              onPress={update.available !== null ? update.install : update.check}
            />
          )}
        </View>
      </View>

      <Modal transparent animationType="fade" visible={confirmingSignOut} onRequestClose={() => setConfirmingSignOut(false)}>
        <View style={styles.scrim}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Sign out?</Text>
            <Text style={styles.rowMeta}>Syncing stops on this TV until you sign in again. You will need your account password.</Text>
            <View style={styles.dialogActions}>
              <Button primary preferred label="Stay signed in" onPress={() => setConfirmingSignOut(false)} />
              <Button
                label="Sign out"
                onPress={() => {
                  setConfirmingSignOut(false);
                  void sync.signOut().then(updateStatus);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

/** A lower-key button for a row of controls that isn't the page's main action — smaller than the standard Button. */
function SmallButton({ label, onPress, primary = false, muted = false, disabled = false }: { label: string; onPress: () => void; primary?: boolean; muted?: boolean; disabled?: boolean }) {
  return (
    <Focusable
      onPress={onPress}
      disabled={disabled}
      style={[smallStyles.button, primary && smallStyles.primary, muted && smallStyles.muted, disabled && smallStyles.disabled]}
      focusedStyle={muted ? smallStyles.mutedFocused : primary ? smallStyles.primaryFocused : undefined}
    >
      <Text style={[smallStyles.label, primary && smallStyles.primaryLabel, muted && smallStyles.mutedLabel]}>{label}</Text>
    </Focusable>
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

const smallStyles = styleSheet({
  button: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999, backgroundColor: colors.card },
  primary: { backgroundColor: colors.accent },
  muted: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  mutedFocused: { borderColor: colors.fault, backgroundColor: "#f0745c1a" },
  primaryFocused: { backgroundColor: colors.accent },
  disabled: { opacity: 0.5 },
  label: { color: colors.foreground, fontSize: type.small, fontWeight: "600" },
  primaryLabel: { color: colors.accentInk },
  mutedLabel: { color: colors.muted },
});

const styles = styleSheet({
  page: { padding: space.xl },
  main: { gap: space.m },
  // Slim, low-key: this page is about sources, not the account.
  accountStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: space.l, marginBottom: space.m, borderBottomWidth: 1, borderBottomColor: colors.border },
  accountText: { gap: 2 },
  accountEmail: { color: colors.muted, fontSize: type.body, fontWeight: "500" },
  accountSynced: { color: colors.faint, fontSize: type.small },
  accountActions: { flexDirection: "row", gap: space.s },

  list: { gap: space.m, marginTop: space.s },
  row: { flexDirection: "row", alignItems: "center", gap: space.l, padding: space.l, backgroundColor: colors.raised, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  rowText: { width: 420, gap: 4 },
  rowName: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
  rowKind: { color: colors.faint, fontSize: type.small, fontWeight: "500" },
  rowMeta: { color: colors.muted, fontSize: type.small },
  rowStatus: { flex: 1 },
  rowSynced: { color: colors.accent, fontSize: type.small },
  error: { color: colors.fault, fontSize: type.small },
  rowActions: { flexDirection: "row", gap: space.s },

  footer: { flexDirection: "row", alignItems: "center", gap: space.l, marginTop: space.xl, paddingTop: space.l, borderTopWidth: 1, borderTopColor: colors.border },
  footerText: { flex: 1, color: colors.faint, fontSize: type.small },
  footerDot: { color: colors.border },

  scrim: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5, 8, 11, 0.8)" },
  dialog: { width: 760, gap: space.l, padding: space.xl, backgroundColor: colors.raised, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: space.m },
  dialogTitle: { color: colors.foreground, fontSize: type.title, fontWeight: "600" },
});
