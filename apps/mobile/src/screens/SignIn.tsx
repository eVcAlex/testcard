import { useState } from "react";
import { Text, View } from "react-native";
import { useApp } from "../state/app";
import { colors, space, type, styleSheet } from "../theme";
import { Button, Field, Heading, Muted } from "../ui/controls";

/**
 * Signing in is how a TV gets its sources: type nothing about providers here, sign in to the same
 * account as the desktop app and its sources, favourites and progress arrive.
 */
export function SignInScreen() {
  const { sync, status, updateStatus } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"signIn" | "signUp" | undefined>();
  const [error, setError] = useState<string | undefined>(status.lastError);

  async function submit(mode: "signIn" | "signUp") {
    setBusy(mode);
    setError(undefined);
    try {
      if (mode === "signIn") await sync.signIn(email.trim(), password);
      else await sync.signUp(email.trim(), password);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn't work. Try again.");
    } finally {
      setBusy(undefined);
      updateStatus();
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.panel}>
        <Text style={styles.brand}>
          TEST<Text style={styles.brandAccent}>CARD</Text>
        </Text>
        <Heading>Sign in</Heading>
        <Muted>Use the same account as Testcard on your computer. Your sources and favourites will follow you here.</Muted>

        <Field
          label="Email"
          preferred
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          textContentType="password"
        />
        {error !== undefined && <Text style={styles.error}>{error}</Text>}

        <View style={styles.actions}>
          <Button
            label={busy === "signUp" ? "Working..." : "Sign up"}
            disabled={busy !== undefined || email.trim() === "" || password === ""}
            onPress={() => void submit("signUp")}
          />
          <Button
            primary
            label={busy === "signIn" ? "Working..." : "Sign in"}
            disabled={busy !== undefined || email.trim() === "" || password === ""}
            onPress={() => void submit("signIn")}
          />
        </View>
      </View>
    </View>
  );
}

const styles = styleSheet({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  panel: { width: "60%", maxWidth: 820, gap: space.l, padding: space.xl, backgroundColor: colors.raised, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  brand: { color: colors.foreground, fontSize: type.lead, fontWeight: "700" },
  brandAccent: { color: colors.accent },
  error: { color: colors.fault, fontSize: type.body },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.m },
});
