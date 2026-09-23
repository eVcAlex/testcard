import { useEffect } from "react";
import { BackHandler, Text, TVFocusGuideView, View } from "react-native";
import { colors, styleSheet } from "../theme";
import { MenuRow } from "./MenuRow";

/** The row id that stands for every source at once. */
export const ALL_SOURCES = "all";

/**
 * The one place the app's source is chosen: "All sources" or one of them, for every page at once. Opens under the
 * Source button in the nav bar; choosing closes it, and so does Back. Focus is held inside while it is open.
 */
export function SourcePicker({
  sources,
  picked,
  onPick,
  onClose,
}: {
  sources: readonly { id: string; name: string }[];
  /** Null for all sources. */
  picked: string | null;
  onPick: (sourceId: string | null) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const choose = (id: string) => onPick(id === ALL_SOURCES ? null : id);
  return (
    <View style={styles.scrim}>
      <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.panel}>
        <Text style={styles.heading}>Show content from</Text>
        <MenuRow id={ALL_SOURCES} label="All sources" active={picked === null} preferred={picked === null} onPressId={choose} />
        {sources.map((source) => (
          <MenuRow key={source.id} id={source.id} label={source.name} active={picked === source.id} preferred={picked === source.id} onPressId={choose} />
        ))}
      </TVFocusGuideView>
    </View>
  );
}

const styles = styleSheet({
  scrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 30, backgroundColor: "#00000080", alignItems: "flex-end" },
  panel: { marginTop: 104, marginRight: 44, width: 520, padding: 14, gap: 4, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised },
  heading: { color: colors.faint, fontSize: 20, fontWeight: "500", paddingHorizontal: 26, paddingTop: 8, paddingBottom: 10 },
});
