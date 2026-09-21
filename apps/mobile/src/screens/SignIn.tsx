import { useEffect, useState } from "react";
import { BackHandler, Keyboard, Text, View } from "react-native";
import { formatLinkCode } from "@testcard/core/src/sync/linkCrypto.js";
import { LinkExpiredError, startLinkSession } from "@testcard/core/src/sync/linkSession.js";
import { syncPlatform } from "../platform/secrets";
import { useApp } from "../state/app";
import { QrCode } from "../ui/QrCode";
import { colors, space, type, styleSheet } from "../theme";
import { Button, Field, Heading, Muted } from "../ui/controls";

/**
 * Signing in is how a TV gets its sources: type nothing about providers here, sign in to the same
 * account as the desktop app and its sources, favourites and progress arrive.
 */
export function SignInScreen() {
  const { sync, status, updateStatus } = useApp();
  // A fresh TV starts with a code to enter on a phone or computer; typing a password with a remote is the fallback.
  const [mode, setMode] = useState<"code" | "form">("code");
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

  if (mode === "code") return <CodeSignIn onTypeInstead={() => setMode("form")} />;

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
          <Button label="Use a code instead" onPress={() => setMode("code")} />
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

/** The address people open on a phone or computer, shown without the scheme. */
const linkAddress = `${syncPlatform.baseUrl.replace("https://", "")}/link`;

/**
 * Sign in without typing: the TV shows a code and a QR, the person answers on a phone or computer, and this
 * screen picks the sign-in up. The password crosses only as a sealed blob the server cannot open.
 */
function CodeSignIn({ onTypeInstead }: { onTypeInstead: () => void }) {
  const { sync, updateStatus } = useApp();
  const [round, setRound] = useState(0);
  const [offer, setOffer] = useState<{ code: string; expiresAt: number }>();
  const [phase, setPhase] = useState<"starting" | "waiting" | "signing" | "failed">("starting");
  const [message, setMessage] = useState<string>();
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const cancel = new AbortController();
    setPhase("starting");
    setOffer(undefined);
    setMessage(undefined);
    (async () => {
      try {
        const session = await startLinkSession(syncPlatform.baseUrl);
        setOffer({ code: session.code, expiresAt: session.expiresAt });
        setPhase("waiting");
        const { email, password } = await session.waitForApproval(cancel.signal);
        setPhase("signing");
        await sync.signIn(email, password);
      } catch (failure) {
        if (cancel.signal.aborted) return;
        // A code that ran out is replaced with a new one without the person asking.
        if (failure instanceof LinkExpiredError) return setRound((value) => value + 1);
        setPhase("failed");
        setMessage(failure instanceof Error ? failure.message : "That didn't work.");
      } finally {
        updateStatus();
      }
    })();
    return () => cancel.abort();
  }, [round, sync, updateStatus]);

  useEffect(() => {
    if (offer === undefined) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((offer.expiresAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [offer]);

  const url = offer !== undefined ? `https://${linkAddress}#${offer.code}` : undefined;
  return (
    <View style={styles.screen}>
      <View style={styles.codePanel}>
        <View style={styles.codeText}>
          <Text style={styles.brand}>
            TEST<Text style={styles.brandAccent}>CARD</Text>
          </Text>
          <Heading>Sign in with your phone</Heading>
          <Muted>On your phone or computer, go to</Muted>
          <Text style={styles.address}>{linkAddress}</Text>
          <Muted>and enter this code:</Muted>
          <Text style={styles.code}>{offer !== undefined ? formatLinkCode(offer.code) : "........"}</Text>
          <Text style={styles.status}>
            {phase === "signing"
              ? "Signing you in..."
              : phase === "failed"
                ? (message ?? "That didn't work.")
                : phase === "waiting"
                  ? `Waiting for you. The code lasts ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")} more.`
                  : "Getting a code..."}
          </Text>
          <View style={styles.codeActions}>
            {phase === "failed" ? <Button primary label="Try again" onPress={() => setRound((value) => value + 1)} /> : null}
            <Button preferred label="Use email and password" onPress={onTypeInstead} />
          </View>
        </View>
        <View style={styles.qrColumn}>
          {url !== undefined && phase !== "failed" ? <QrCode text={url} size={380} /> : <View style={styles.qrEmpty} />}
          <Text style={styles.qrHint}>Or scan this with your phone</Text>
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
  codePanel: { width: "78%", maxWidth: 1400, flexDirection: "row", gap: 64, padding: 56, backgroundColor: colors.raised, borderRadius: 24, borderWidth: 1, borderColor: colors.border },
  codeText: { flex: 1, gap: space.m },
  codeActions: { flexDirection: "row", gap: space.m, marginTop: 8 },
  address: { color: colors.accent, fontSize: 36, fontWeight: "600" },
  code: { color: colors.foreground, fontSize: 96, fontWeight: "600", letterSpacing: 8, marginVertical: 8 },
  status: { color: colors.muted, fontSize: 26 },
  qrColumn: { alignItems: "center", justifyContent: "center", gap: space.m },
  qrEmpty: { width: 380, height: 380, borderRadius: 16, backgroundColor: colors.card },
  qrHint: { color: colors.muted, fontSize: 24 },
});
