import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Check, InfoCircle, Play, Plus, Restart, Xmark } from "iconoir-react-native";
import { colors, styleSheet, uiScale } from "../theme";

const u = (n: number) => Math.round(n * uiScale);
const INK = "#0b0e10";

export type ActionGlyph = "restart" | "plus" | "check" | "cross" | "info";

const ACTION_GLYPHS = { restart: Restart, plus: Plus, check: Check, cross: Xmark, info: InfoCircle };

function Glyph({ kind, color }: { kind: ActionGlyph; color: string }) {
  const Icon = ACTION_GLYPHS[kind];
  return <Icon color={color} width={u(30)} height={u(30)} strokeWidth={1.75} />;
}

function PlayGlyph({ color }: { color: string }) {
  return <Play color={color} width={u(28)} height={u(28)} strokeWidth={1.75} />;
}

export interface DetailAction {
  readonly key: string;
  readonly label: string;
  readonly glyph: ActionGlyph;
  readonly onPress: () => void;
}

/**
 * What you can do with a film or episode: one big Play pill, then a few round icon buttons. The focused
 * icon's name shows underneath, so nothing needs a long label.
 */
export function DetailActions({
  primary,
  actions,
  preferred = true,
  hintBeside = false,
}: {
  primary: { label: string; onPress: () => void; /** 0 to 1: how far through it you are, drawn inside the pill. */ progress?: number | undefined };
  actions: readonly DetailAction[];
  /** Claim focus when shown. Off where the screen sits under a nav bar that should keep it. */
  preferred?: boolean;
  /** Show the focused icon's name to the right of the buttons instead of underneath, for a container that clips below them. */
  hintBeside?: boolean;
}) {
  const [hint, setHint] = useState("");
  const [playFocused, setPlayFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          focusable
          hasTVPreferredFocus={preferred}
          onPress={primary.onPress}
          onFocus={() => {
            setPlayFocused(true);
            setHint("");
          }}
          onBlur={() => setPlayFocused(false)}
          style={[styles.play, playFocused && styles.playFocused]}
        >
          <PlayGlyph color={playFocused ? INK : colors.foreground} />
          <Text style={[styles.playLabel, { color: playFocused ? INK : colors.foreground }]}>{primary.label}</Text>
          {primary.progress !== undefined && primary.progress > 0 ? (
            <View style={styles.playTrack}>
              <View style={[styles.playFill, { width: `${Math.min(100, primary.progress * 100)}%` }]} />
            </View>
          ) : null}
        </Pressable>
        {actions.map((action) => (
          <IconButton key={action.key} action={action} onHint={setHint} />
        ))}
        {hintBeside && actions.length > 0 ? <Text style={styles.hintBeside}>{hint}</Text> : null}
      </View>
      {!hintBeside && actions.length > 0 ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function IconButton({ action, onHint }: { action: DetailAction; onHint: (label: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      onPress={action.onPress}
      onFocus={() => {
        setFocused(true);
        onHint(action.label);
      }}
      onBlur={() => {
        setFocused(false);
        onHint("");
      }}
      style={[styles.icon, focused && styles.iconFocused]}
    >
      <Glyph kind={action.glyph} color={focused ? INK : colors.foreground} />
    </Pressable>
  );
}

/** Year, length and rating as small quiet chips. */
export function Facts({ facts }: { facts: readonly string[] }) {
  if (facts.length === 0) return null;
  return (
    <View style={styles.facts}>
      {facts.map((fact) => (
        <View key={fact} style={styles.fact}>
          <Text style={styles.factLabel}>{fact}</Text>
        </View>
      ))}
    </View>
  );
}

/** The poster, blurred and dimmed, filling the page behind the content. */
export function Backdrop({ uri }: { uri: string | null }) {
  if (uri === null || uri === "") return null;
  return (
    <View style={styles.backdrop} pointerEvents="none">
      <Image source={{ uri }} style={styles.backdropImage} blurRadius={30} contentFit="cover" cachePolicy="memory-disk" />
      <View style={styles.backdropShade} />
    </View>
  );
}

const styles = styleSheet({
  wrap: { gap: 14, marginTop: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 16 },
  // At rest this reads the same as the round icon buttons beside it (quiet, translucent) so only the
  // remote's actual focus target ever looks "filled" — a permanently bright pill used to make Resume
  // look selected even when focus had moved elsewhere.
  play: { height: 72, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 36, borderRadius: 36, backgroundColor: "#ffffff1f", borderWidth: 3, borderColor: "transparent" },
  playFocused: { backgroundColor: colors.foreground, borderColor: colors.accent, transform: [{ scale: 1.04 }] },
  playTrack: { position: "absolute", left: 40, right: 40, bottom: 7, height: 3, borderRadius: 2, backgroundColor: "#ffffff33" },
  playFill: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
  playLabel: { fontSize: 26, fontWeight: "600" },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff1f" },
  iconFocused: { backgroundColor: colors.foreground, transform: [{ scale: 1.06 }] },
  facts: { flexDirection: "row", gap: 12 },
  fact: { height: 44, paddingHorizontal: 20, borderRadius: 22, justifyContent: "center", backgroundColor: "#ffffff14" },
  factLabel: { color: colors.foreground, fontSize: 23, fontWeight: "500" },
  hint: { height: 34, color: colors.muted, fontSize: 24 },
  hintBeside: { color: colors.muted, fontSize: 26, marginLeft: 6 },
  backdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  backdropImage: { width: "100%", height: "100%", opacity: 0.5 },
  backdropShade: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#0c0e1199" },
});
