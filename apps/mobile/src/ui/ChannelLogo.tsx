import { memo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, uiScale } from "../theme";

/** Quiet, dark tones that sit with the rest of the app; a channel keeps the same one wherever it is shown. */
const TONES = ["#2b3a4a", "#3a2f45", "#23413a", "#4a3328", "#2f3d24", "#452a33", "#26364a", "#3d3a26", "#1f3f45", "#40283f"];

const QUALITY = /^(?:\d*K|UHD|FHD|HDR\d*|HD|SD|\d{3,4}P\d{0,3}|HEVC|H\.?265)$/i;

/**
 * Up to four letters that stand for a channel when it has no logo: "BBC One" → "BBC1", "Sky News" → "SN",
 * "Channel 4" → "C4", "Film4 +1" → "F4+1", "Discovery" → "D". Quality words ("HD", "4K") are left out.
 */
export function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s+&]/gu, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !QUALITY.test(word));
  if (words.length === 0) return name.trim().slice(0, 2).toUpperCase();
  const [first = "", second] = words;
  const numberWords: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5" };
  const secondMark = second === undefined ? "" : /^\+?\d{1,2}\+?$/.test(second) ? second : (numberWords[second.toLowerCase()] ?? "");
  // A name that leads with an acronym or a number ("BBC", "ITV2", "5USA") is best known by it.
  if (/^[\p{Lu}\p{N}]{2,4}\+?$/u.test(first)) return (first + secondMark).slice(0, 4);
  // "Film4" is "F4".
  const lead = first[0]! + (/\d+$/.exec(first)?.[0] ?? "");
  if (secondMark !== "" || lead.length > 1) return (lead + secondMark).toUpperCase().slice(0, 4);
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function toneFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TONES[Math.abs(hash) % TONES.length]!;
}

/**
 * A channel's logo filling its panel, or, when the source has none or it will not load, the channel's letters on a
 * colour of its own, so a list is never a run of blank tiles. `size` is the letters' font size in 1920 px design units.
 */
export const ChannelLogo = memo(function ChannelLogo({ url, name, size, recyclingKey }: { url: string | null | undefined; name: string; size: number; recyclingKey?: string }) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const usable = url !== null && url !== undefined && url !== "" && url !== brokenUrl;
  if (usable) {
    return <Image source={{ uri: url }} style={styles.image} contentFit="contain" cachePolicy="memory-disk" recyclingKey={recyclingKey ?? url} onError={() => setBrokenUrl(url)} />;
  }
  const letters = monogram(name);
  return (
    <View style={[StyleSheet.absoluteFill, styles.monogram, { backgroundColor: toneFor(name) }]}>
      <Text style={[styles.letters, { fontSize: Math.round(size * uiScale * (letters.length > 3 ? 0.8 : 1)) }]} numberOfLines={1} adjustsFontSizeToFit>
        {letters}
      </Text>
    </View>
  );
});

// Plain StyleSheet: the letters are scaled above, from the caller's design-unit size.
const styles = StyleSheet.create({
  image: { width: "100%", height: "100%" },
  monogram: { alignItems: "center", justifyContent: "center" },
  letters: { color: colors.foreground, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, opacity: 0.92 },
});
