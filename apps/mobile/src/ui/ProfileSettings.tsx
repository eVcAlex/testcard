import { useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { NavArrowRight, Plus } from "iconoir-react-native";
import { useApp } from "../state/app";
import { AVATARS, MAIN_PROFILE, newProfileId, nextColour, pinHash, pinMatches, PROFILE_COLOURS, type Profile } from "../state/profiles";
import { colors, space, type, styleSheet, uiScale } from "../theme";
import { Avatar } from "./Avatar";
import { Button, Field } from "./controls";
import { Focusable } from "./Focusable";
import { OptionsSheet } from "./OptionsSheet";
import { PinPad } from "./PinPad";

const ARROW = Math.round(24 * uiScale);
const MAX_PROFILES = 6;

type Action = "rename" | "avatar" | "pin" | "unpin" | "delete";

type Pad =
  /** The profile's PIN, before anything about a locked profile is changed. */
  | { step: "check"; profile: Profile; next: Action }
  | { step: "choose"; profile: Profile; first?: string; mismatch?: boolean };

/**
 * The Profiles pane in Settings: who watches. Profiles are the account's, so they are on every TV signed in to it.
 * OK on a profile offers what can be done to it; a locked one asks for its PIN first.
 */
export function ProfileSettings() {
  const { profiles, profile: current, saveProfile, deleteProfile } = useApp();
  const [sheet, setSheet] = useState<Profile>();
  const [pad, setPad] = useState<Pad>();
  // A name being typed: for a new profile (no `profile`) or a rename.
  const [naming, setNaming] = useState<{ profile?: Profile; text: string }>();
  const [deleting, setDeleting] = useState<Profile>();
  // The profile whose avatar is being chosen, by id: it is read from the list, so the picker shows each change.
  const [dressing, setDressing] = useState<string>();
  const dressed = profiles.find((entry) => entry.id === dressing);

  const update = (id: string, change: Partial<Profile>) => {
    const profile = profiles.find((entry) => entry.id === id);
    if (profile !== undefined) saveProfile({ ...profile, ...change });
  };

  const act = (profile: Profile, action: Action) => {
    if (action === "rename") setNaming({ profile, text: profile.name });
    else if (action === "avatar") setDressing(profile.id);
    else if (action === "pin") setPad({ step: "choose", profile });
    else if (action === "unpin") update(profile.id, { pin: null });
    else setDeleting(profile);
  };
  const choose = (profile: Profile, action: Action) => {
    if (profile.pin !== null) setPad({ step: "check", profile, next: action });
    else act(profile, action);
  };

  const actions = (profile: Profile) => [
    { id: "avatar", label: "Choose avatar" },
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
    else {
      // A new profile goes straight on to its avatar.
      const id = newProfileId();
      saveProfile({ id, name, colour: nextColour(profiles), avatar: null, pin: null, position: Math.max(0, ...profiles.map((entry) => entry.position)) + 1 });
      setDressing(id);
    }
    setNaming(undefined);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.heading}>Profiles</Text>
      <Text style={styles.note}>
        Profiles are on your account, so they are on all your TVs. Each has its own Continue watching, favourites and recents everywhere, and its own Home pins and caption settings on each TV. Your computer shows your own.
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
                    {[profile.id === current.id ? "Watching now" : null, profile.id === MAIN_PROFILE ? "Your account's own" : null, profile.pin !== null ? "PIN" : null].filter((part) => part !== null).join("  ·  ")}
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

      <Modal transparent animationType="fade" visible={dressed !== undefined} onRequestClose={() => setDressing(undefined)}>
        {dressed !== undefined ? (
          <View style={styles.scrim}>
            <View style={[styles.dialog, styles.picker]}>
              <View style={styles.pickerHead}>
                <Avatar profile={dressed} size={112} />
                <Text style={styles.dialogTitle}>{dressed.name}</Text>
              </View>
              <View style={styles.grid}>
                {[null, ...AVATARS.map((entry) => entry.id)].map((avatar, index) => (
                  <Focusable key={avatar ?? "letter"} preferred={avatar === dressed.avatar || (index === 0 && dressed.avatar === null)} onPress={() => update(dressed.id, { avatar })} style={[styles.choice, avatar === dressed.avatar && styles.choiceOn]} focusedStyle={styles.choiceFocused}>
                    <Avatar profile={{ ...dressed, avatar, pin: null }} size={84} />
                  </Focusable>
                ))}
              </View>
              <View style={styles.colours}>
                {PROFILE_COLOURS.map((colour, index) => (
                  <Focusable key={colour} onPress={() => update(dressed.id, { colour: index })} style={[styles.colour, { backgroundColor: colour }, dressed.colour % PROFILE_COLOURS.length === index && styles.colourOn]} focusedStyle={styles.colourFocused}>
                    {null}
                  </Focusable>
                ))}
              </View>
              <View style={styles.dialogActions}>
                <Button primary label="Done" onPress={() => setDressing(undefined)} />
              </View>
            </View>
          </View>
        ) : null}
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
  picker: { width: 1080 },
  pickerHead: { flexDirection: "row", alignItems: "center", gap: space.l },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  choice: { padding: 6, borderRadius: 999, borderWidth: 3, borderColor: "transparent" },
  choiceOn: { borderColor: colors.muted },
  choiceFocused: { borderColor: colors.foreground, transform: [{ scale: 1.1 }] },
  colours: { flexDirection: "row", gap: 18, justifyContent: "center" },
  colour: { width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: "transparent" },
  colourOn: { borderColor: colors.muted },
  colourFocused: { borderColor: colors.foreground, transform: [{ scale: 1.15 }] },
  dialogTitle: { color: colors.foreground, fontSize: type.title, fontWeight: "600" },
});
