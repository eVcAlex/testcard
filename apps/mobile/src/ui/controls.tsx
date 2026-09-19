import { useRef, useState } from "react";
import { Platform, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, space, type, styleSheet } from "../theme";
import { Focusable } from "./Focusable";

export function Button({
  label,
  onPress,
  primary = false,
  disabled = false,
  preferred = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  preferred?: boolean;
}) {
  return (
    <Focusable
      onPress={onPress}
      disabled={disabled}
      preferred={preferred}
      style={[styles.button, primary ? styles.primary : styles.secondary, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonLabel, primary && styles.primaryLabel]}>{label}</Text>
    </Focusable>
  );
}

/**
 * A text field that is also a focus stop. On a TV the field is a plain focus stop and the keyboard
 * opens only when the remote's select is pressed, so landing on a screen (or moving past a field)
 * never throws the keyboard up over the form. On a phone the input is used directly.
 */
export function Field({ label, preferred = false, ...input }: TextInputProps & { label: string; preferred?: boolean }) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<TextInput>(null);
  const tv = Platform.isTV;
  const field = (ringed: boolean) => (
    <TextInput
      {...input}
      ref={ref}
      focusable={!tv}
      placeholderTextColor={colors.faint}
      onFocus={(event) => {
        setFocused(true);
        input.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        input.onBlur?.(event);
      }}
      style={[styles.input, (focused || ringed) && styles.inputFocused]}
    />
  );
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {tv ? (
        <Focusable onPress={() => ref.current?.focus()} preferred={preferred} style={styles.stop} focusedStyle={styles.stopFocused}>
          {({ focused: ringed }) => field(ringed)}
        </Focusable>
      ) : (
        field(false)
      )}
    </View>
  );
}

export function Heading({ children }: { children: string }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Muted({ children }: { children: string }) {
  return <Text style={styles.muted}>{children}</Text>;
}

const styles = styleSheet({
  button: { paddingVertical: space.m, paddingHorizontal: space.xl, alignItems: "center" },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.card },
  disabled: { opacity: 0.5 },
  buttonLabel: { color: colors.foreground, fontSize: type.body, fontWeight: "600" },
  primaryLabel: { color: colors.accentInk },
  field: { gap: space.s },
  fieldLabel: { color: colors.muted, fontSize: type.small },
  input: {
    backgroundColor: colors.sunken,
    color: colors.foreground,
    fontSize: type.body,
    paddingVertical: space.m,
    paddingHorizontal: space.m,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: colors.border,
  },
  stop: { borderWidth: 0 },
  stopFocused: { transform: [{ scale: 1 }] },
  inputFocused: { borderColor: colors.accent },
  heading: { color: colors.foreground, fontSize: type.title, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: type.body },
});
