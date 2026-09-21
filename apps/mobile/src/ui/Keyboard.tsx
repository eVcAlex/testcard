import { Text, View } from "react-native";
import { colors, styleSheet } from "../theme";
import { Focusable } from "./Focusable";

const ROWS = ["abcdef", "ghijkl", "mnopqr", "stuvwx", "yz0123", "456789"];

/**
 * A keyboard the remote can drive: letters and digits in a grid, then space, delete and clear. The system
 * keyboard on a TV means a pop-up over the results and one key press per letter through a text box; this stays
 * beside the results so they update as you type.
 */
export function Keyboard({ onType, onSpace, onDelete, onClear }: { onType: (char: string) => void; onSpace: () => void; onDelete: () => void; onClear: () => void }) {
  return (
    <View style={styles.wrap}>
      {ROWS.map((row) => (
        <View key={row} style={styles.row}>
          {[...row].map((char) => (
            <Key key={char} label={char} onPress={() => onType(char)} />
          ))}
        </View>
      ))}
      <View style={styles.row}>
        <Key label="Space" wide onPress={onSpace} />
        <Key label="Delete" wide onPress={onDelete} />
        <Key label="Clear" wide onPress={onClear} />
      </View>
    </View>
  );
}

function Key({ label, onPress, wide = false }: { label: string; onPress: () => void; wide?: boolean }) {
  return (
    <Focusable onPress={onPress} style={[styles.key, wide && styles.wide]} focusedStyle={styles.keyFocused}>
      {({ focused }) => <Text style={[styles.label, wide && styles.wideLabel, focused && styles.labelFocused]}>{wide ? label : label.toUpperCase()}</Text>}
    </Focusable>
  );
}

const styles = styleSheet({
  wrap: { gap: 10 },
  row: { flexDirection: "row", gap: 10 },
  key: { width: 84, height: 84, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "#ffffff14" },
  wide: { width: 180 },
  keyFocused: { backgroundColor: colors.foreground, borderColor: "transparent" },
  label: { color: colors.foreground, fontSize: 34, fontWeight: "500" },
  wideLabel: { fontSize: 26 },
  labelFocused: { color: colors.background },
});
