import { useEffect, useState } from "react";
import { BackHandler, Keyboard, Text, View } from "react-native";
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
  // The on-screen keyboard covers the lower half of the screen, so the form moves to the top while it is open.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setTyping(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setTyping(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const [error, setError] = useState<string | undefined>(status.lastError);
  // Sign up sits next to Sign in and makes a new account, so it asks first. Back answers "no".
  const [confirmingSignUp, setConfirmingSignUp] = useState(false);
  useEffect(() => {
    if (!confirmingSignUp) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setConfirmingSignUp(false);
      return true;
    });
    return () => subscription.remove();
  }, [confirmingSignUp]);

  async function submit(mode: "signIn" | "signUp") {
    Keyboard.dismiss();
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

  if (confirmingSignUp) {
    return (
      <View style={styles.screen}>
        <View style={styles.panel}>
          <Text style={styles.brand}>
            TEST<Text style={styles.brandAccent}>CARD</Text>
          </Text>
          <Heading>Create a new account?</Heading>
          <Muted>
            This makes a brand new Testcard account with no sources. If you already use Testcard on your computer, go back and choose Sign in with that account.
          </Muted>
          <View style={styles.actions}>
            <Button
              primary
              preferred
              label="Go back"
              onPress={() => setConfirmingSignUp(false)}
            />
            <Button
              label="Create account"
              onPress={() => {
                setConfirmingSignUp(false);
                void submit("signUp");
              }}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, typing && styles.screenTyping]}>
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
            onPress={() => setConfirmingSignUp(true)}
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
  screenTyping: { justifyContent: "flex-start", paddingTop: 24 },
  panel: { width: "60%", maxWidth: 820, gap: space.l, padding: space.xl, backgroundColor: colors.raised, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  brand: { color: colors.foreground, fontSize: type.lead, fontWeight: "700" },
  brandAccent: { color: colors.accent },
  error: { color: colors.fault, fontSize: type.body },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.m },
});
