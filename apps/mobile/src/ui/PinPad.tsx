import { useEffect, useState } from "react";
import { BackHandler, Text, TVFocusGuideView, View } from "react-native";
import { Erase } from "iconoir-react-native";
import { colors, styleSheet, uiScale } from "../theme";
import { Focusable } from "./Focusable";

export const PIN_LENGTH = 4;

const KEYS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "erase"],
];

const ERASE = Math.round(34 * uiScale);

/**
 * Four digits typed on an on-screen pad (a Fire TV remote has no number keys). Once the fourth is in, `onEntered`
 * says whether it was right; if not, the dots clear and `wrong` is shown. Back closes it.
 */
export function PinPad({
  title,
  note,
  wrong = "That's not the PIN. Try again.",
  onEntered,
  onClose,
}: {
  title: string;
  note?: string;
  wrong?: string;
  /** False to clear and try again; anything else and the caller closes the pad (or changes its title for a second entry). */
  onEntered: (digits: string) => boolean | void;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);
  // A new title means a new question (the second "confirm" entry): start it empty.
  useEffect(() => {
    setDigits("");
    setFailed(false);
  }, [title]);

  const press = (key: string) => {
    if (key === "erase") return setDigits((current) => current.slice(0, -1));
    const next = `${digits}${key}`.slice(0, PIN_LENGTH);
    setFailed(false);
    if (next.length < PIN_LENGTH) return setDigits(next);
    setDigits("");
    if (onEntered(next) === false) setFailed(true);
  };

  return (
    <View style={styles.scrim}>
      <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.panel}>
        <Text style={styles.title}>{title}</Text>
        <Text style={[styles.note, failed && styles.wrong]}>{failed ? wrong : (note ?? " ")}</Text>
        <View style={styles.dots}>
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <View key={index} style={[styles.dot, index < digits.length && styles.dotFilled]} />
          ))}
        </View>
        <View style={styles.pad}>
          {KEYS.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.padRow}>
              {row.map((key, index) =>
                key === "" ? (
                  <View key={index} style={[styles.key, styles.keyBlank]} />
                ) : (
                  <Focusable key={key} preferred={key === "5"} onPress={() => press(key)} style={styles.key} focusedStyle={styles.keyFocused}>
                    {({ focused }) =>
                      key === "erase" ? <Erase color={focused ? colors.background : colors.muted} width={ERASE} height={ERASE} strokeWidth={1.75} /> : <Text style={[styles.digit, focused && styles.digitFocused]}>{key}</Text>
                    }
                  </Focusable>
                ),
              )}
            </View>
          ))}
        </View>
      </TVFocusGuideView>
    </View>
  );
}

const styles = styleSheet({
  scrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 40, backgroundColor: "#000000c7", alignItems: "center", justifyContent: "center" },
  panel: { width: 620, alignItems: "center", gap: 18, paddingVertical: 44, paddingHorizontal: 40, borderRadius: 28, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised },
  title: { color: colors.foreground, fontSize: 34, fontWeight: "600", textAlign: "center" },
  note: { color: colors.muted, fontSize: 22, textAlign: "center", minHeight: 30 },
  wrong: { color: colors.fault },
  dots: { flexDirection: "row", gap: 22, marginVertical: 10 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 3, borderColor: colors.muted },
  dotFilled: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  pad: { gap: 14 },
  padRow: { flexDirection: "row", gap: 14 },
  key: { width: 112, height: 88, borderRadius: 20, borderWidth: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff12" },
  keyBlank: { backgroundColor: "transparent" },
  keyFocused: { backgroundColor: colors.foreground, transform: [{ scale: 1.06 }] },
  digit: { color: colors.foreground, fontSize: 36, fontWeight: "500" },
  digitFocused: { color: colors.background },
});
