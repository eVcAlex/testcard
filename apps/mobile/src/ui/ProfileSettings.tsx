import { useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { NavArrowRight, Plus } from "iconoir-react-native";
import { useApp } from "../state/app";
import { MAIN_PROFILE, newProfileId, nextColour, pinHash, pinMatches, type Profile } from "../state/profiles";
import { colors, space, type, styleSheet, uiScale } from "../theme";
import { Avatar } from "./Avatar";
import { Button, Field } from "./controls";
import { Focusable } from "./Focusable";
import { OptionsSheet } from "./OptionsSheet";
import { PinPad } from "./PinPad";

const ARROW = Math.round(24 * uiScale);
const MAX_PROFILES = 6;

type Action = "rename" | "pin" | "unpin" | "delete";

type Pad =
  /** The profile's PIN, before anything about a locked profile is changed. */
  | { step: "check"; profile: Profile; next: Action }
  | { step: "choose"; profile: Profile; first?: string; mismatch?: boolean };

/**
 * The Profiles pane in Settings: who watches on this TV, each with their own Continue watching, favourites, Home
 * pins and caption settings. OK on a profile offers what can be done to it; a locked one asks for its PIN first.
 */
export function ProfileSettings() {
  const { profiles, profile: current, saveProfiles, deleteProfile } = useApp();
  const [sheet, setSheet] = useState<Profile>();
  const [pad, setPad] = useState<Pad>();
  // A name being typed: for a new profile (no `profile`) or a rename.
  const [naming, setNaming] = useState<{ profile?: Profile; text: string }>();
  const [deleting, setDeleting] = useState<Profile>();
  const main = profiles.find((entry) => entry.id === MAIN_PROFILE);

  const update = (id: string, change: Partial<Profile>) => saveProfiles(profiles.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));

  const act = (profile: Profile, action: Action) => {
    if (action === "rename") setNaming({ profile, text: profile.name });
    else if (action === "pin") setPad({ step: "choose", profile });
    else if (action === "unpin") update(profile.id, { pin: null });
    else setDeleting(profile);
  };
  const choose = (profile: Profile, action: Action) => {
    if (profile.pin !== null) setPad({ step: "check", profile, next: action });
    else act(profile, action);
  };

  const actions = (profile: Profile) => [
    { id: "rename", label: "Rename" },
    { id: "pin", label: profile.pin === null ? "Lock with a PIN" : "Change PIN" },
    ...(profile.pin !== null ? [{ id: "unpin", label: "Remove PIN" }] : []),
    ...(profile.id !== MAIN_PROFILE && profile.id !== current.id ? [{ id: "delete", label: "Delete profile" }] : []),
  ];

  const saveName = () => {
    if (naming === undefined) return;
    const name = naming.text.trim().slice(0, 20);
    if (name === "") return;
    if (naming.profile !== undefined) update(naming.profile.id, { name });
    else saveProfiles([...profiles, { id: newProfileId(), name, colour: nextColour(profiles), pin: null }]);
    setNaming(undefined);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.heading}>Profiles</Text>
      <Text style={styles.note}>
        {`Each profile has its own Continue watching, favourites, Home pins and caption settings. ${main?.name ?? "Main"} is your account's own and syncs with your other devices; the others stay on this TV.`}
      </Text>
      <View style={styles.list}>
        {profiles.map((profile) => (
          <Focusable key={profile.id} onPress={() => setSheet(profile)} style={styles.row} focusedStyle={styles.rowFocused}>
            {({ focused }) => (
              <>
                <Avatar profile={profile} size={60} />
                <View style={styles.rowText}>
                  <Text style={[styles.name, focused && styles.inkFocused]} numberOfLines={1}>
                    {profile.name}
                  </Text>
                  <Text style={[styles.meta, focused && styles.inkFocused]} numberOfLines={1}>
                    {[profile.id === current.id ? "Watching now" : null, profile.id === MAIN_PROFILE ? "Syncs with your account" : "This TV only", profile.pin !== null ? "PIN" : null].filter((part) => part !== null).join("  ·  ")}
                  </Text>
                </View>
                <NavArrowRight color={focused ? colors.background : colors.faint} width={ARROW} height={ARROW} strokeWidth={2} />
              </>
            )}
          </Focusable>
        ))}
        {profiles.length < MAX_PROFILES ? (
          <Focusable onPress={() => setNaming({ text: "" })} style={styles.row} focusedStyle={styles.rowFocused}>
            {({ focused }) => (
              <>
                <View style={styles.addDisc}>
                  <Plus color={focused ? colors.background : colors.muted} width={ARROW * 1.4} height={ARROW * 1.4} strokeWidth={2} />
                </View>
                <Text style={[styles.name, focused && styles.inkFocused]}>Add profile</Text>
              </>
            )}
          </Focusable>
        ) : null}
      </View>

      <Modal transparent animationType="fade" visible={sheet !== undefined} onRequestClose={() => setSheet(undefined)}>
        {sheet !== undefined ? <OptionsSheet title={sheet.name} options={actions(sheet)} onChoose={(id) => choose(sheet, id as Action)} onClose={() => setSheet(undefined)} /> : null}
      </Modal>

      <Modal transparent animationType="fade" visible={pad !== undefined} onRequestClose={() => setPad(undefined)}>
        {pad?.step === "check" ? (
          <PinPad
            title={`Enter ${pad.profile.name}'s PIN`}
            onEntered={(digits) => {
              if (!pinMatches(pad.profile, digits)) return false;
              setPad(undefined);
              act(pad.profile, pad.next);
            }}
            onClose={() => setPad(undefined)}
          />
        ) : pad?.step === "choose" ? (
          <PinPad
            title={pad.first === undefined ? `Choose a PIN for ${pad.profile.name}` : "Enter it again"}
            note={pad.mismatch === true ? "Those didn't match. Choose it again." : pad.first === undefined ? "Four digits, asked for before this profile opens." : undefined}
            onEntered={(digits) => {
              if (pad.first === undefined) return setPad({ step: "choose", profile: pad.profile, first: digits });
              if (digits !== pad.first) return setPad({ step: "choose", profile: pad.profile, mismatch: true });
              update(pad.profile.id, { pin: pinHash(pad.profile.id, digits) });
              setPad(undefined);
            }}
            onClose={() => setPad(undefined)}
          />
        ) : null}
      </Modal>

      <Modal transparent animationType="fade" visible={naming !== undefined} onRequestClose={() => setNaming(undefined)}>
        <View style={styles.scrim}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{naming?.profile !== undefined ? "Rename profile" : "Add a profile"}</Text>
            <Field label="Name" preferred value={naming?.text ?? ""} maxLength={20} autoCapitalize="words" returnKeyType="done" onChangeText={(text) => setNaming((now) => (now === undefined ? now : { ...now, text }))} onSubmitEditing={saveName} />
            <View style={styles.dialogActions}>
              <Button label="Cancel" onPress={() => setNaming(undefined)} />
              <Button primary label="Save" disabled={(naming?.text.trim() ?? "") === ""} onPress={saveName} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent animationType="fade" visible={deleting !== undefined} onRequestClose={() => setDeleting(undefined)}>
        <View style={styles.scrim}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{`Delete ${deleting?.name ?? ""}?`}</Text>
            <Text style={styles.meta}>Their Continue watching, favourites, pins and settings on this TV go too. This can't be undone.</Text>
            <View style={styles.dialogActions}>
              <Button primary preferred label="Keep it" onPress={() => setDeleting(undefined)} />
              <Button
                label="Delete"
                onPress={() => {
                  if (deleting !== undefined) deleteProfile(deleting.id);
                  setDeleting(undefined);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = styleSheet({
  page: { padding: space.xl, gap: space.s },
  heading: { color: colors.foreground, fontSize: type.title, fontWeight: "700" },
  note: { color: colors.muted, fontSize: type.body, maxWidth: 980, lineHeight: 32 },
  list: { width: 720, gap: 10, marginTop: space.l },
  row: { height: 96, flexDirection: "row", alignItems: "center", gap: 22, paddingHorizontal: 22, borderRadius: 16, borderWidth: 0, backgroundColor: colors.raised },
  rowFocused: { backgroundColor: colors.foreground, transform: [{ scale: 1.02 }] },
  rowText: { flex: 1, gap: 4 },
  name: { color: colors.foreground, fontSize: type.body, fontWeight: "500" },
  meta: { color: colors.muted, fontSize: type.small },
  inkFocused: { color: colors.background },
  addDisc: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5, 8, 11, 0.8)" },
  dialog: { width: 760, gap: space.l, padding: space.xl, backgroundColor: colors.raised, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: space.m },
  dialogTitle: { color: colors.foreground, fontSize: type.title, fontWeight: "600" },
});
