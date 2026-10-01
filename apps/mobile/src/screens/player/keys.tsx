import { memo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ArrowLeft, Backward15Seconds, ClosedCaptionsTag, Forward15Seconds, Headset, NavArrowLeft, NavArrowRight, Pause, Play, SkipNext } from "iconoir-react-native";
import { colors, styleSheet, uiScale } from "../../theme";

/** A length written in 1920 px design units, for the shapes in the player that are sized in code. */
export const u = (n: number) => Math.round(n * uiScale);

/** The dark ink of a key drawn white under the remote's highlight. */
export const INK = "#0b0e10";

/** A transport key: a bare glyph at rest, a solid white disc with a dark glyph when the remote's highlight is on it. */
export function Key({ big = false, selected = false, active = false, disabled = false, onPress, children }: { big?: boolean; selected?: boolean; active?: boolean; disabled?: boolean; onPress: () => void; children: (ink: string) => ReactNode }) {
  const filled = selected || active;
  return (
    <Pressable
      focusable={false}
      onPress={disabled ? undefined : onPress}
      style={[styles.key, big ? styles.keyBig : styles.keySmall, filled && styles.keyFilled, filled && { transform: [{ scale: 1.08 }] }, disabled && styles.keyDisabled]}
    >
      {children(filled ? INK : disabled ? "#ffffff42" : colors.foreground)}
    </Pressable>
  );
}

/** A transport key with a word on it, for the few actions that have no familiar symbol. */
export function TextKey({ label, dot = false, selected = false, onPress }: { label: string; /** A red dot: this is the state the viewer is in right now (watching live). */ dot?: boolean; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable focusable={false} onPress={onPress} style={[styles.key, styles.textKey, selected && styles.keyFilled, selected && { transform: [{ scale: 1.08 }] }]}>
      {dot ? <View style={styles.keyDot} /> : null}
      <Text style={[styles.textKeyLabel, selected && { color: INK }]}>{label}</Text>
    </Pressable>
  );
}

/** A key of the options row: its symbol in a disc (white under the remote's highlight), what it is below, and what it is set to. */
export function OptionKey({ icon: Icon, label, value, selected = false, onPress }: { icon: typeof Headset; label: string; value: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable focusable={false} onPress={onPress} style={styles.optionKey}>
      <View style={[styles.key, styles.keySmall, styles.optionDisc, selected && styles.keyFilled, selected && { transform: [{ scale: 1.08 }] }]}>
        <Icon color={selected ? INK : colors.foreground} width={u(36)} height={u(36)} strokeWidth={1.75} />
      </View>
      <Text style={[styles.optionLabel, selected && styles.optionLabelLit]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.optionValue} numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
  );
}

/** The closed-captions mark: cream as an icon while a track is on. */
export function CcGlyph({ on, color }: { on: boolean; color: string }) {
  return <ClosedCaptionsTag color={on ? colors.accent : color} width={u(38)} height={u(38)} strokeWidth={1.75} />;
}

/** Skip-to-next: the streaming apps' "next episode" mark. */
export function NextGlyph({ color }: { color: string }) {
  return <SkipNext color={color} width={u(38)} height={u(38)} strokeWidth={1.75} />;
}

/**
 * A darkening that fades out from one edge. It is layered rather than banded: each layer covers from the edge
 * to a little further in, so the darkness builds up in many small steps with no seams between them. (Solid
 * stacked bands showed as stripes across the picture on a big screen.)
 */
const SCRIM_LAYERS = 28;
const SCRIM_ALPHAS = (() => {
  const darkness = (band: number) => (band >= SCRIM_LAYERS ? 0 : 0.85 * (1 - (band + 0.5) / SCRIM_LAYERS) ** 1.5);
  // Layer i covers the first i of the bands, so a band under layers i..N is as dark as the product of them says.
  return Array.from({ length: SCRIM_LAYERS }, (_, index) => 1 - (1 - darkness(index)) / (1 - darkness(index + 1)));
})();

export const Scrim = memo(function Scrim({ from }: { from: "top" | "bottom" }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {SCRIM_ALPHAS.map((alpha, index) => (
        <View key={index} style={{ position: "absolute", left: 0, right: 0, [from]: 0, height: `${((index + 1) / SCRIM_LAYERS) * 100}%`, backgroundColor: `rgba(5,7,9,${alpha.toFixed(4)})` }} />
      ))}
    </View>
  );
});

export function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

export function ChevronGlyph({ color }: { color: string }) {
  return <ArrowLeft color={color} width={u(32)} height={u(32)} strokeWidth={1.75} />;
}

/** Previous and next channel. */
export function ChannelGlyph({ direction, color }: { direction: "back" | "forward"; color: string }) {
  const Icon = direction === "back" ? NavArrowLeft : NavArrowRight;
  return <Icon color={color} width={u(40)} height={u(40)} strokeWidth={1.75} />;
}

export function PauseGlyph({ color }: { color: string }) {
  return <Pause color={color} width={u(42)} height={u(42)} strokeWidth={1.75} />;
}

export function PlayGlyph({ color }: { color: string }) {
  return <Play color={color} width={u(44)} height={u(44)} strokeWidth={1.75} />;
}

/** Replay and advance by the seek step. */
export function SkipGlyph({ direction, color }: { direction: "back" | "forward"; color: string }) {
  const Icon = direction === "back" ? Backward15Seconds : Forward15Seconds;
  return <Icon color={color} width={u(44)} height={u(44)} strokeWidth={1.75} />;
}

const styles = styleSheet({
  key: { alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  keySmall: { width: 80, height: 80, borderRadius: 40 },
  keyBig: { width: 92, height: 92, borderRadius: 46 },
  keyFilled: { backgroundColor: colors.foreground, borderColor: "transparent" },
  keyDisabled: { opacity: 0.35 },
  textKey: { height: 80, borderRadius: 40, paddingHorizontal: 32, backgroundColor: "#ffffff24", flexDirection: "row", gap: 12 },
  keyDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.live },
  textKeyLabel: { color: colors.foreground, fontSize: 26, fontWeight: "500" },
  optionKey: { width: 170, alignItems: "center", gap: 6 },
  optionDisc: { backgroundColor: "#ffffff1a", marginBottom: 4 },
  optionLabel: { color: colors.foreground, opacity: 0.85, fontSize: 22, fontWeight: "500" },
  optionLabelLit: { opacity: 1, fontWeight: "600" },
  optionValue: { color: colors.muted, fontSize: 20, maxWidth: 170 },
  chip: { borderRadius: 7, borderWidth: 2, borderColor: "#ffffff66", paddingHorizontal: 12, paddingVertical: 3 },
  chipText: { color: colors.foreground, fontSize: 20, fontWeight: "600", letterSpacing: 0.5 },
});
