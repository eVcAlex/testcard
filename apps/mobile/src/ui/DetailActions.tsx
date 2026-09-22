import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, styleSheet, uiScale } from "../theme";

const u = (n: number) => Math.round(n * uiScale);
const INK = "#0b0e10";

export type ActionGlyph = "restart" | "plus" | "check" | "cross" | "info";

function Glyph({ kind, color }: { kind: ActionGlyph; color: string }) {
  const size = u(30);
  const bar = { position: "absolute" as const, backgroundColor: color, borderRadius: u(2) };
  if (kind === "plus") {
    return (
      <View style={{ width: size, height: size }}>
        <View style={{ ...bar, left: 0, right: 0, top: size / 2 - u(2), height: u(4) }} />
        <View style={{ ...bar, top: 0, bottom: 0, left: size / 2 - u(2), width: u(4) }} />
      </View>
    );
  }
  if (kind === "cross") {
    return (
      <View style={{ width: size, height: size }}>
        <View style={{ ...bar, left: 0, right: 0, top: size / 2 - u(2), height: u(4), transform: [{ rotate: "45deg" }] }} />
        <View style={{ ...bar, left: 0, right: 0, top: size / 2 - u(2), height: u(4), transform: [{ rotate: "-45deg" }] }} />
      </View>
    );
  }
  if (kind === "check") {
    return <View style={{ width: u(14), height: u(26), borderRightWidth: u(4), borderBottomWidth: u(4), borderColor: color, transform: [{ rotate: "45deg" }, { translateY: -u(3) }] }} />;
  }
  if (kind === "info") {
    // a ring with a dot and a stem
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <View style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, borderWidth: u(3), borderColor: color }} />
        <View style={{ position: "absolute", top: u(6), width: u(4), height: u(4), borderRadius: u(2), backgroundColor: color }} />
        <View style={{ position: "absolute", top: u(12), width: u(4), height: u(11), borderRadius: u(2), backgroundColor: color }} />
      </View>
    );
  }
  // restart: an open ring with an arrowhead
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, borderWidth: u(4), borderColor: color, borderTopColor: "transparent" }} />
      <View
        style={{
          position: "absolute",
          top: u(2) - u(7),
          left: size / 2 - u(8),
          width: 0,
          height: 0,
          borderTopWidth: u(7),
          borderBottomWidth: u(7),
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderRightWidth: u(12),
          borderRightColor: color,
        }}
      />
    </View>
  );
}

function PlayGlyph({ color }: { color: string }) {
  return <View style={{ width: 0, height: 0, borderTopWidth: u(14), borderBottomWidth: u(14), borderLeftWidth: u(22), borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: color, marginLeft: u(4) }} />;
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
          <PlayGlyph color={INK} />
          <Text style={styles.playLabel}>{primary.label}</Text>
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
  play: { height: 72, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 36, borderRadius: 36, backgroundColor: colors.foreground, borderWidth: 3, borderColor: "transparent" },
  playFocused: { borderColor: colors.accent, transform: [{ scale: 1.04 }] },
  playTrack: { position: "absolute", left: 40, right: 40, bottom: 7, height: 3, borderRadius: 2, backgroundColor: "#0b0e1026" },
  playFill: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
  playLabel: { color: INK, fontSize: 26, fontWeight: "600" },
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
