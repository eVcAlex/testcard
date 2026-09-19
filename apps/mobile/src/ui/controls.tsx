import { useState } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
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

/** A text field that is also a focus stop: selecting it with the remote opens the on-screen keyboard. */
export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        placeholderTextColor={colors.faint}
        onFocus={(event) => {
          setFocused(true);
          input.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          input.onBlur?.(event);
        }}
        style={[styles.input, focused && styles.inputFocused]}
      />
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
  inputFocused: { borderColor: colors.accent },
  heading: { color: colors.foreground, fontSize: type.title, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: type.body },
});
