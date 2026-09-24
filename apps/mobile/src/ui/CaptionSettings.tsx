import { useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { NavArrowRight } from "iconoir-react-native";
import { useApp } from "../state/app";
import { CAPTION_SETTINGS, settingLabel, settingValue, withSetting, type CaptionSetting } from "../playback/captions";
import { colors, space, type, styleSheet, uiScale } from "../theme";
import { CaptionPreview } from "./CaptionPreview";
import { Focusable } from "./Focusable";
import { OptionsSheet } from "./OptionsSheet";

/** When captions come on, then how they look: two short groups rather than one long list. */
const GROUPS: { title: string; keys: readonly CaptionSetting["key"][] }[] = [
  { title: "When", keys: ["always", "language"] },
  { title: "Look", keys: ["size", "color", "background", "edge"] },
];

const ARROW = Math.round(24 * uiScale);

/**
 * The captions settings pane: whether films and episodes start with them on and in which language, and how they
 * look, beside a preview. OK on a row opens its choices, and the preview beside them follows the highlight, so a
 * look is seen before it is picked. The same settings are in the player's captions menu.
 */
export function CaptionSettings() {
  const { captions, setCaptions } = useApp();
  const [open, setOpen] = useState<CaptionSetting>();
  // The choice highlighted in the open list, previewed before it is picked.
  const [trying, setTrying] = useState<string>();
  const close = () => {
    setOpen(undefined);
    setTrying(undefined);
  };
  // Whether and in which language they come on is not something a picture shows.
  const looks = open !== undefined && open.key !== "always" && open.key !== "language";
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.heading}>Captions</Text>
      <Text style={styles.note}>Films and episodes, on this TV.</Text>
      <View style={styles.body}>
        <View style={styles.groups}>
          {GROUPS.map((group) => (
            <View key={group.title} style={styles.group}>
              <Text style={styles.groupTitle}>{group.title}</Text>
              {group.keys.map((key) => {
                const setting = CAPTION_SETTINGS.find((entry) => entry.key === key);
                if (setting === undefined) return null;
                const idle = key === "language" && !captions.always;
                return (
                  <Focusable key={key} onPress={() => setOpen(setting)} style={styles.row} focusedStyle={styles.rowFocused}>
                    {({ focused }) => (
                      <>
                        <Text style={[styles.label, focused && styles.inkFocused]}>{setting.label}</Text>
                        <Text style={[styles.value, idle && styles.valueIdle, focused && styles.inkFocused]} numberOfLines={1}>
                          {settingLabel(captions, setting)}
                        </Text>
                        <NavArrowRight color={focused ? colors.background : colors.faint} width={ARROW} height={ARROW} strokeWidth={2} />
                      </>
                    )}
                  </Focusable>
                );
              })}
            </View>
          ))}
        </View>
        <View style={styles.previewColumn}>
          <CaptionPreview prefs={captions} />
          <Text style={styles.previewNote}>{captions.always ? `On by themselves, in ${settingLabel(captions, CAPTION_SETTINGS[1]!)}` : "Off until you turn them on with the CC button"}</Text>
        </View>
      </View>
      <Modal transparent animationType="fade" visible={open !== undefined} onRequestClose={close}>
        {open !== undefined ? (
          <OptionsSheet
            title={open.label}
            options={open.values}
            preferredId={settingValue(captions, open.key)}
            aside={looks ? <CaptionPreview prefs={withSetting(captions, open.key, trying ?? settingValue(captions, open.key))} /> : undefined}
            onFocusId={setTrying}
            onChoose={(id) => setCaptions(withSetting(captions, open.key, id))}
            onClose={close}
          />
        ) : null}
      </Modal>
    </ScrollView>
  );
}

const styles = styleSheet({
  page: { padding: space.xl, gap: space.s },
  heading: { color: colors.foreground, fontSize: type.title, fontWeight: "700" },
  note: { color: colors.muted, fontSize: type.body },
  body: { flexDirection: "row", alignItems: "flex-start", gap: 44, marginTop: space.l },
  groups: { width: 560, gap: space.xl },
  group: { gap: 6 },
  groupTitle: { color: colors.faint, fontSize: 18, fontWeight: "600", letterSpacing: 2, textTransform: "uppercase", paddingLeft: 4, marginBottom: 4 },
  // A quiet list: rows only fill in under the remote, like the app's menus.
  row: { height: 72, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 24, borderRadius: 14, borderWidth: 0, backgroundColor: colors.raised },
  rowFocused: { backgroundColor: colors.foreground, transform: [{ scale: 1.02 }] },
  label: { flex: 1, color: colors.foreground, fontSize: type.body, fontWeight: "500" },
  value: { color: colors.muted, fontSize: type.body },
  valueIdle: { color: colors.faint },
  inkFocused: { color: colors.background },
  previewColumn: { gap: space.m, paddingTop: 34 },
  previewNote: { color: colors.faint, fontSize: type.small },
});
