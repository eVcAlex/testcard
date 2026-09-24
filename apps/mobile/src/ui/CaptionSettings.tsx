import { useState } from "react";
import { Modal, Text, View } from "react-native";
import { useApp } from "../state/app";
import { CAPTION_SETTINGS, settingLabel, settingValue, withSetting, type CaptionSetting } from "../playback/captions";
import { colors, space, type, styleSheet } from "../theme";
import { CaptionPreview } from "./CaptionPreview";
import { Focusable } from "./Focusable";
import { OptionsSheet } from "./OptionsSheet";

/**
 * The captions settings: whether films and episodes start with them on and in which language, and how they look.
 * One row per setting, beside a preview of how captions will look; OK opens a setting's choices, and the preview
 * beside them follows the highlight, so a look can be judged before it is picked. The same settings are in the
 * player's captions panel, where a change shows on the picture at once.
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
    <View style={styles.section}>
      <Text style={styles.heading}>Captions</Text>
      <Text style={styles.note}>For films and episodes on this device. They can also be changed from the captions menu while something plays.</Text>
      <View style={styles.body}>
        <View style={styles.list}>
          {CAPTION_SETTINGS.map((setting) => (
            <Focusable key={setting.key} onPress={() => setOpen(setting)} style={styles.row}>
              <Text style={styles.label}>{setting.label}</Text>
              <Text style={[styles.value, setting.key === "language" && !captions.always && styles.valueIdle]}>{settingLabel(captions, setting)}</Text>
            </Focusable>
          ))}
        </View>
        <CaptionPreview prefs={captions} />
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
    </View>
  );
}

const styles = styleSheet({
  section: { gap: space.s, marginTop: space.xl },
  heading: { color: colors.foreground, fontSize: type.title, fontWeight: "700" },
  note: { color: colors.muted, fontSize: type.body },
  body: { flexDirection: "row", alignItems: "flex-start", gap: space.xl, marginTop: space.s },
  list: { flex: 1, gap: space.s },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.l, paddingVertical: space.m, backgroundColor: colors.raised },
  label: { flex: 1, color: colors.foreground, fontSize: type.body, fontWeight: "500" },
  value: { color: colors.accent, fontSize: type.body },
  valueIdle: { color: colors.faint },
});
