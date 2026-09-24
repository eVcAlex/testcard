import { useEffect } from "react";
import { BackHandler, ScrollView, Text, TVFocusGuideView, View } from "react-native";
import { colors, styleSheet } from "../theme";
import { MenuRow } from "./MenuRow";

export interface SheetOption {
  readonly id: string;
  readonly label: string;
}

/**
 * A short list of things to do with one title, opened by holding select on it. Choosing one runs it and closes the
 * sheet; Back closes it too. Focus is held inside while it is open, on `preferredId` or else the first option.
 * A long list scrolls.
 */
export function OptionsSheet({ title, options, preferredId, onChoose, onClose }: { title: string; options: readonly SheetOption[]; preferredId?: string; onChoose: (id: string) => void; onClose: () => void }) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const choose = (id: string) => {
    onClose();
    onChoose(id);
  };
  return (
    <View style={styles.scrim}>
      <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.panel}>
        <Text style={styles.heading} numberOfLines={1}>
          {title}
        </Text>
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {options.map((option, index) => (
            <MenuRow key={option.id} id={option.id} label={option.label} active={option.id === preferredId} preferred={preferredId !== undefined && options.some((entry) => entry.id === preferredId) ? option.id === preferredId : index === 0} onPressId={choose} />
          ))}
        </ScrollView>
      </TVFocusGuideView>
    </View>
  );
}

const styles = styleSheet({
  scrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 30, backgroundColor: "#000000a6", alignItems: "center", justifyContent: "center" },
  panel: { width: 640, padding: 14, gap: 4, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised },
  list: { maxHeight: 780, flexGrow: 0 },
  heading: { color: colors.faint, fontSize: 20, fontWeight: "500", paddingHorizontal: 26, paddingTop: 8, paddingBottom: 10 },
});
