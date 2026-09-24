import { useState } from "react";
import { Modal, Text, View } from "react-native";
import { useApp } from "../state/app";
import { CAPTION_SETTINGS, settingLabel, settingValue, withSetting, type CaptionSetting } from "../playback/captions";
import { colors, space, type, styleSheet } from "../theme";
import { Focusable } from "./Focusable";
import { OptionsSheet } from "./OptionsSheet";

/**
 * The captions settings: whether films and episodes start with them on and in which language, and how they look.
 * One row per setting; OK opens its choices. The same settings are in the player's captions panel, where a
 * change shows on the picture at once.
 */
export function CaptionSettings() {
  const { captions, setCaptions } = useApp();
  const [open, setOpen] = useState<CaptionSetting>();
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Captions</Text>
      <Text style={styles.note}>For films and episodes on this device. Style changes show straight away in the player's captions menu too.</Text>
      <View style={styles.list}>
        {CAPTION_SETTINGS.map((setting) => (
          <Focusable key={setting.key} onPress={() => setOpen(setting)} style={styles.row}>
            <Text style={styles.label}>{setting.label}</Text>
            <Text style={[styles.value, setting.key === "language" && !captions.always && styles.valueIdle]}>{settingLabel(captions, setting)}</Text>
          </Focusable>
        ))}
      </View>
      <Modal transparent animationType="fade" visible={open !== undefined} onRequestClose={() => setOpen(undefined)}>
        {open !== undefined ? (
          <OptionsSheet
            title={open.label}
            options={open.values}
            preferredId={settingValue(captions, open.key)}
            onChoose={(id) => setCaptions(withSetting(captions, open.key, id))}
            onClose={() => setOpen(undefined)}
          />
        ) : null}
      </Modal>
    </View>
  );
}

const styles = styleSheet({
  section: { gap: space.s, marginTop: space.xl },
  heading: { color: colors.foreground, fontSize: type.title, fontWeight: "700" },
  note: { color: colors.muted, fontSize: type.body },
  list: { gap: space.s, marginTop: space.s },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.l, paddingVertical: space.m, backgroundColor: colors.raised },
  label: { flex: 1, color: colors.foreground, fontSize: type.body, fontWeight: "500" },
  value: { color: colors.accent, fontSize: type.body },
  valueIdle: { color: colors.faint },
});
