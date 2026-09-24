import { Modal, ScrollView, Text, TVFocusGuideView, View } from "react-native";
import { Button } from "../ui/controls";
import { colors, space, type, styleSheet } from "../theme";
import { installedVersion } from "./update";
import { useUpdate } from "./UpdateProvider";

/**
 * "A new version is ready": what changed since the installed build, and Update now or Later. Update now downloads it
 * here, with its progress, then Android asks once to install it; nothing else to open or download by hand.
 */
export function UpdatePrompt() {
  const update = useUpdate();
  const info = update.available;
  if (!update.prompting || info === null) return null;
  const working = update.phase === "downloading" || update.phase === "installing";
  const changes = info.notes.flatMap((note) => note.changes);
  const status =
    update.phase === "downloading"
      ? `Downloading ${Math.round(update.progress * 100)}%`
      : update.phase === "installing"
        ? "Opening the installer..."
        : update.phase === "permission"
          ? "Android needs your OK first: allow Testcard to install unknown apps. Settings opens; turn Testcard on, then come back and the update carries on."
          : update.phase === "error" && update.error !== undefined
            ? update.error
            : null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={working ? () => undefined : update.later}>
      <View style={styles.scrim}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{`Testcard ${info.versionName} is ready`}</Text>
          <Text style={styles.meta}>{`You have ${installedVersion().name}.`}</Text>
          {changes.length > 0 ? (
            <ScrollView style={styles.notes} contentContainerStyle={styles.notesBody}>
              {changes.slice(0, 12).map((change, index) => (
                <Text key={index} style={styles.change}>
                  {`•  ${change}`}
                </Text>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.change}>Fixes and improvements.</Text>
          )}
          {update.phase === "downloading" ? (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(update.progress * 100)}%` }]} />
            </View>
          ) : null}
          {status !== null ? <Text style={[styles.meta, update.phase === "error" && styles.error]}>{status}</Text> : null}
          <TVFocusGuideView autoFocus style={styles.actions}>
            <Button label="Later" disabled={working} onPress={update.later} />
            {update.phase === "permission" ? (
              <Button primary preferred label="Open settings" onPress={update.openInstallSetting} />
            ) : (
              <Button primary preferred label={update.phase === "error" ? "Try again" : working ? "Updating..." : "Update now"} disabled={working} onPress={update.install} />
            )}
          </TVFocusGuideView>
        </View>
      </View>
    </Modal>
  );
}

const styles = styleSheet({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5, 8, 11, 0.85)" },
  dialog: { width: 900, maxHeight: 900, gap: space.l, padding: space.xl, backgroundColor: colors.raised, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.foreground, fontSize: type.title, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: type.small },
  error: { color: colors.fault },
  notes: { maxHeight: 420 },
  notesBody: { gap: space.s },
  change: { color: colors.foreground, fontSize: type.body, lineHeight: 32 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.card, overflow: "hidden" },
  fill: { height: 8, backgroundColor: colors.accent },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.m },
});
