import { useEffect, useState } from "react";
import { Modal, ScrollView, Text, TVFocusGuideView, View } from "react-native";
import { useApp } from "../state/app";
import { emptyDraft, readDraft, type SourceDraft } from "../state/sourceEdit";
import { colors, space, type, styleSheet } from "../theme";
import { Button, Field } from "./controls";
import { Focusable } from "./Focusable";

const CONTENT: { key: keyof SourceDraft["content"]; label: string }[] = [
  { key: "live", label: "Live TV" },
  { key: "movies", label: "Movies" },
  { key: "series", label: "Series" },
];

/**
 * Add a source (`sourceId` undefined) or change one: its name, login or playlist link, TV guide address, and which
 * kinds of content it loads. The provider is asked before anything is kept; the change reaches the other devices.
 */
export function SourceForm({ sourceId, onClose }: { sourceId: string | undefined; onClose: () => void }) {
  const { db, saveSource } = useApp();
  const [draft, setDraft] = useState<SourceDraft | undefined>(sourceId === undefined ? emptyDraft("xtream") : undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (sourceId === undefined) return;
    let live = true;
    void readDraft(db, sourceId).then((found) => {
      if (!live) return;
      if (found === undefined) onClose();
      else setDraft(found);
    });
    return () => {
      live = false;
    };
  }, [db, sourceId, onClose]);

  const change = (patch: Partial<SourceDraft>) => {
    setError(undefined);
    setDraft((current) => (current === undefined ? current : { ...current, ...patch }));
  };
  const save = () => {
    if (draft === undefined || saving) return;
    setSaving(true);
    setError(undefined);
    saveSource(sourceId, draft).then(onClose, (failure: unknown) => {
      setSaving(false);
      setError(failure instanceof Error ? failure.message : "That didn't save.");
    });
  };

  const adding = sourceId === undefined;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{adding ? "Add a source" : `Edit ${draft?.name ?? "source"}`}</Text>
          {draft === undefined ? (
            <Text style={styles.note}>Loading...</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.body}>
              <TVFocusGuideView autoFocus style={styles.body}>
                {adding ? (
                  <View style={styles.chips}>
                    <Chip label="Xtream login" on={draft.kind === "xtream"} preferred onPress={() => change({ kind: "xtream" })} />
                    <Chip label="Playlist link (M3U)" on={draft.kind === "m3u"} onPress={() => change({ kind: "m3u" })} />
                  </View>
                ) : null}
                <Field label="Name" value={draft.name} onChangeText={(name) => change({ name })} placeholder="What to call it" preferred={!adding} />
                {draft.kind === "xtream" ? (
                  <>
                    <Field label="Server address" value={draft.server} onChangeText={(server) => change({ server })} placeholder="http://provider.example:8080" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
                    <Field label="Username" value={draft.username} onChangeText={(username) => change({ username })} autoCapitalize="none" autoCorrect={false} />
                    <Field
                      label="Password"
                      value={draft.password}
                      onChangeText={(password) => change({ password })}
                      placeholder={adding ? "" : "Unchanged"}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </>
                ) : (
                  <Field
                    label={adding ? "Playlist link (an Xtream get.php link works too)" : "Playlist link"}
                    value={draft.playlistUrl}
                    onChangeText={(playlistUrl) => change({ playlistUrl })}
                    placeholder="http://..."
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                )}
                <Field
                  label="TV guide address (optional)"
                  value={draft.epgUrl}
                  onChangeText={(epgUrl) => change({ epgUrl })}
                  placeholder="Empty uses the source's own guide"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <Text style={styles.label}>Load</Text>
                <View style={styles.chips}>
                  {CONTENT.map((entry) => (
                    <Chip key={entry.key} label={entry.label} on={draft.content[entry.key]} tick onPress={() => change({ content: { ...draft.content, [entry.key]: !draft.content[entry.key] } })} />
                  ))}
                </View>
              </TVFocusGuideView>
            </ScrollView>
          )}
          <Text style={[styles.note, error !== undefined && styles.error]} numberOfLines={2}>
            {error ?? (saving ? "Checking with the provider..." : "Changes reach your other devices when they next sync.")}
          </Text>
          <View style={styles.actions}>
            <Button label="Cancel" onPress={onClose} />
            <Button primary label={saving ? "Checking..." : adding ? "Add source" : "Save"} disabled={saving || draft === undefined} onPress={save} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, on, onPress, preferred = false, tick = false }: { label: string; on: boolean; onPress: () => void; preferred?: boolean; tick?: boolean }) {
  return (
    <Focusable onPress={onPress} preferred={preferred} style={[styles.chip, on && styles.chipOn]} focusedStyle={styles.chipFocused}>
      {({ focused }) => <Text style={[styles.chipLabel, on && styles.chipLabelOn, focused && styles.chipLabelFocused]}>{tick ? `${on ? "✓" : "○"}  ${label}` : label}</Text>}
    </Focusable>
  );
}

const styles = styleSheet({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5, 8, 11, 0.85)" },
  dialog: { width: 1080, maxHeight: 1000, gap: space.l, padding: space.xl, backgroundColor: colors.raised, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.foreground, fontSize: type.title, fontWeight: "600" },
  body: { gap: space.m },
  label: { color: colors.muted, fontSize: type.small, marginTop: space.s },
  chips: { flexDirection: "row", gap: space.m },
  chip: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 999, borderWidth: 2, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipFocused: { backgroundColor: colors.foreground, borderColor: colors.foreground, transform: [{ scale: 1.05 }] },
  chipLabel: { color: colors.muted, fontSize: type.body, fontWeight: "500" },
  chipLabelOn: { color: colors.foreground },
  chipLabelFocused: { color: colors.background },
  note: { color: colors.faint, fontSize: type.small },
  error: { color: colors.fault },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.m },
});
