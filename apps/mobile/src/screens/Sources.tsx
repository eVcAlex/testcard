import { useCallback, useMemo, useState } from "react";
import { Modal, ScrollView, Text, TVFocusGuideView, View } from "react-native";
import { WarningCircle } from "iconoir-react-native";
import { useApp, type SourceSummary } from "../state/app";
import { useUpdate } from "../update/UpdateProvider";
import { installedVersion } from "../update/update";
import { colors, space, type, styleSheet, uiScale } from "../theme";
import { Button, Heading, Muted } from "../ui/controls";
import { CaptionSettings } from "../ui/CaptionSettings";
import { ProfileSettings } from "../ui/ProfileSettings";
import { Focusable } from "../ui/Focusable";
import { MenuRow, withCommas } from "../ui/MenuRow";
import { SourceForm } from "../ui/SourceForm";
import { plainReason } from "../ui/plainReason";
import { listHidden, unhide } from "@testcard/core/src/sync/hidden.js";
import { describeAccount, useSourceAccount } from "../state/account";
import { backupInUse } from "../state/hosts";

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

type Pane = "sources" | "hidden" | "profiles" | "captions" | "account";
const PANES: { id: Pane; label: string }[] = [
  { id: "sources", label: "Sources" },
  { id: "hidden", label: "Hidden" },
  { id: "profiles", label: "Profiles" },
  { id: "captions", label: "Captions" },
  { id: "account", label: "Account and updates" },
];

/**
 * The Settings tab: a short menu down the left (Sources, Hidden, Profiles, Captions, Account and updates) and the chosen one beside
 * it. The pane follows the remote as it moves down the menu, as the category lists do; Right goes into it.
 */
export function SourcesScreen() {
  const [pane, setPane] = useState<Pane>("sources");
  const choose = (id: string) => setPane(id as Pane);
  return (
    <View style={styles.settings}>
      <TVFocusGuideView autoFocus style={styles.menu}>
        {PANES.map((entry) => (
          <MenuRow key={entry.id} id={entry.id} label={entry.label} active={pane === entry.id} onPressId={choose} onFocusId={choose} />
        ))}
      </TVFocusGuideView>
      <View style={styles.pane}>{pane === "sources" ? <SourcesPane /> : pane === "hidden" ? <HiddenPane /> : pane === "profiles" ? <ProfileSettings /> : pane === "captions" ? <CaptionSettings /> : <AccountPane />}</View>
    </View>
  );
}

function SourcesPane() {
  const { sources, refreshSource, removeSource, status } = useApp();
  // Removing is permanent (and reaches the other devices), so it takes a second press.
  const [confirming, setConfirming] = useState<string>();
  // The source being edited: an id, "new" for one being added, or nothing.
  const [editing, setEditing] = useState<string>();
  const closeForm = useCallback(() => setEditing(undefined), []);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.main}>
        <View style={styles.headRow}>
          <View style={styles.headText}>
            <Heading>Sources</Heading>
            <Muted>
              {status.account === "signed-in"
                ? "Adding, editing or removing a source here changes it on all your devices."
                : "Sign in to load your sources."}
            </Muted>
          </View>
          {status.account === "signed-in" ? <SmallButton primary label="Add source" onPress={() => setEditing("new")} /> : null}
        </View>
        {status.lastError !== undefined && <Text style={styles.error}>{status.lastError}</Text>}
        {sources.length === 0 && <Muted>No sources have arrived yet. Sync runs every minute, or press Sync now in Account and updates.</Muted>}

        <View style={styles.list}>
          {sources.map((source) => (
            <View key={source.id} style={[styles.row, source.failures.length > 0 && !source.refreshing && styles.rowFailed]}>
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {source.name}
                  <Text style={styles.rowKind}>{`   ${source.kind === "xtream" ? "Xtream" : "M3U"}`}</Text>
                </Text>
                <Text style={styles.rowMeta}>{source.refreshing ? "Loading..." : counts(source.channels, source.movies, source.series)}</Text>
                <AccountLine sourceId={source.id} kind={source.kind} />
                {backupInUse(source.id) !== undefined ? (
                  <Text style={[styles.rowMeta, styles.accountWarn]} numberOfLines={1}>
                    {`Main server not answering. Using ${backupInUse(source.id)?.replace(/^https?:\/\//, "")}`}
                  </Text>
                ) : null}
              </View>
              <View style={styles.rowStatus}>
                {source.refreshing ? (
                  <Text style={styles.rowSynced}>Refreshing...</Text>
                ) : source.failures.length > 0 ? (
                  <Problem source={source} />
                ) : (
                  source.lastRefreshedAt !== null && <Text style={styles.rowSynced}>{`✓ Synced ${ago(source.lastRefreshedAt)}`}</Text>
                )}
              </View>
              <View style={styles.rowActions}>
                <SmallButton label={source.refreshing ? "Refreshing" : source.failures.length > 0 ? "Try again" : "Refresh"} disabled={source.refreshing} onPress={() => void refreshSource(source.id)} />
                <SmallButton label="Edit" disabled={source.refreshing} onPress={() => setEditing(source.id)} />
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
      </View>
      {editing !== undefined ? <SourceForm sourceId={editing === "new" ? undefined : editing} onClose={closeForm} /> : null}
    </ScrollView>
  );
}

const HIDDEN_KIND = { live: "Live TV category", movies: "Movies category", series: "Series category", channel: "Channel" } as const;

/** What was hidden, on any device, each with a way to bring it back. */
function HiddenPane() {
  const { db, sync, version, updateStatus, sources } = useApp();
  const entries = useMemo(() => {
    void version;
    return listHidden(db);
  }, [db, version]);
  const mixed = sources.length > 1;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.main}>
        <Heading>Hidden</Heading>
        <Muted>
          {entries.length === 0
            ? "Nothing is hidden. Hide a category from its page in Browse all, or a channel from its options."
            : "These are left out of every list, row and search, on all your devices."}
        </Muted>
        <View style={styles.list}>
          {entries.map((entry) => (
            <View key={`${entry.sourceId}|${entry.kind}|${entry.key}`} style={styles.row}>
              <View style={styles.hiddenText}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {entry.label}
                </Text>
                <Text style={styles.rowMeta}>{mixed ? `${HIDDEN_KIND[entry.kind]}  ·  ${entry.sourceName}` : HIDDEN_KIND[entry.kind]}</Text>
              </View>
              <SmallButton
                label="Show again"
                onPress={() => {
                  unhide(db, entry);
                  sync.notifyLocalChange();
                  updateStatus();
                }}
              />
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

/** Who this TV is signed in as, syncing, and the app's version and updates. */
function AccountPane() {
  const { status, sync, updateStatus } = useApp();
  // Signing out drops the account from this TV, and the button sits right beside Sync now, so it asks first.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const update = useUpdate();
  const version = installedVersion();
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.main}>
        <Heading>Account and updates</Heading>
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

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {`Testcard ${version.name}`}
            <Text style={styles.footerDot}>{"  ·  "}</Text>
            {!update.configured
              ? "Updates are not set up for this build."
              : update.phase === "error" && update.error !== undefined
                ? <Text style={styles.footerError}>{`Couldn't ${update.available !== null ? "update" : "check for updates"}. ${plainReason(update.error, "the update server")}`}</Text>
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
          {update.configured && (
            <View style={styles.accountActions}>
              <SmallButton
                label={`Check automatically: ${update.auto ? "On" : "Off"}`}
                onPress={() => update.setAuto(!update.auto)}
              />
              <SmallButton
                primary={update.available !== null}
                label={update.available !== null ? "Update now" : "Check for updates"}
                disabled={update.phase === "downloading" || update.phase === "checking" || update.phase === "installing"}
                onPress={update.available !== null ? update.showPrompt : update.check}
              />
            </View>
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

/**
 * What went wrong with a source's last import, in two lines: what did not load, then why and what is left.
 * Each reason is said once, in plain words (see plainReason).
 */
function Problem({ source }: { source: SourceSummary }) {
  const parts = new Set(source.failures.map((failure) => failure.part));
  const title = parts.has("all")
    ? "Couldn't refresh this source"
    : parts.has("movies") && parts.has("series")
      ? "Movies and series didn't load"
      : parts.has("movies")
        ? "Movies didn't load"
        : "Series didn't load";
  const reasons = [...new Set(source.failures.map((failure) => plainReason(failure.message)))].filter((reason) => reason !== "");
  const kept = parts.has("all") ? source.channels + source.movies + source.series > 0 : (parts.has("movies") && source.movies > 0) || (parts.has("series") && source.series > 0);
  const detail = [...reasons, kept ? "What loaded last time is still here." : null].filter((line): line is string => line !== null).join(" ");
  return (
    <View style={styles.problem}>
      <WarningCircle width={30 * uiScale} height={30 * uiScale} color={colors.fault} strokeWidth={2} />
      <View style={styles.problemText}>
        <Text style={styles.problemTitle} numberOfLines={1}>
          {title}
        </Text>
        {detail !== "" ? (
          <Text style={styles.rowMeta} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** When an Xtream account ends and how many of its streams are in use, from the provider. Nothing for a playlist. */
function AccountLine({ sourceId, kind }: { sourceId: string; kind: "xtream" | "m3u" }) {
  const account = useSourceAccount(sourceId, kind);
  if (account === undefined || account === null) return null;
  const { text, warn } = describeAccount(account);
  return (
    <Text style={[styles.rowMeta, warn && styles.accountWarn]} numberOfLines={1}>
      {text}
    </Text>
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
  settings: { flex: 1, flexDirection: "row", gap: space.xl },
  menu: { width: 380, paddingTop: space.xl, gap: 4 },
  pane: { flex: 1 },
  page: { padding: space.xl },
  main: { gap: space.m },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: space.l },
  headText: { flex: 1, gap: space.m },
  // Account and app, one card each, like the source rows.
  accountStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.l, padding: space.l, backgroundColor: colors.raised, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  accountText: { gap: 2 },
  accountEmail: { color: colors.foreground, fontSize: type.body, fontWeight: "500" },
  accountSynced: { color: colors.faint, fontSize: type.small },
  accountActions: { flexDirection: "row", gap: space.s },

  list: { gap: space.m, marginTop: space.s },
  row: { flexDirection: "row", alignItems: "center", gap: space.l, padding: space.l, backgroundColor: colors.raised, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  rowText: { width: 500, gap: 4 },
  rowName: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
  rowKind: { color: colors.faint, fontSize: type.small, fontWeight: "500" },
  rowMeta: { color: colors.muted, fontSize: type.small },
  rowStatus: { flex: 1 },
  hiddenText: { flex: 1, gap: 4 },
  accountWarn: { color: colors.fault },
  rowFailed: { borderColor: "#f0745c59" },
  rowSynced: { color: colors.accent, fontSize: type.small },
  problem: { flexDirection: "row", alignItems: "center", gap: 14 },
  problemText: { flex: 1, gap: 2 },
  problemTitle: { color: colors.fault, fontSize: type.small, fontWeight: "600" },
  error: { color: colors.fault, fontSize: type.small },
  rowActions: { flexDirection: "row", gap: space.s },

  footer: { flexDirection: "row", alignItems: "center", gap: space.l, padding: space.l, backgroundColor: colors.raised, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  footerText: { flex: 1, color: colors.muted, fontSize: type.body },
  footerDot: { color: colors.border },
  footerError: { color: colors.fault },

  scrim: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5, 8, 11, 0.8)" },
  dialog: { width: 760, gap: space.l, padding: space.xl, backgroundColor: colors.raised, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: space.m },
  dialogTitle: { color: colors.foreground, fontSize: type.title, fontWeight: "600" },
});
