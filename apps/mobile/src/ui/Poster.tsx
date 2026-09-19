import { memo } from "react";
import { FlatList, Image, Text, View } from "react-native";
import { splitTitle } from "@testcard/core/src/normalise/splitTitle.js";
import { colors, space, type, styleSheet } from "../theme";
import { Focusable } from "./Focusable";

export interface PosterItem {
  readonly id: string;
  readonly name: string;
  readonly posterUrl: string | null;
  /** 0 to 1 when started and not finished. */
  readonly progress?: number | null;
}

const POSTER_WIDTH = 190;

const PosterCard = memo(function PosterCard({ item, onPress }: { item: PosterItem; onPress: (item: PosterItem) => void }) {
  const { title } = splitTitle(item.name);
  const progress = item.progress !== undefined && item.progress !== null && item.progress > 0 ? Math.min(1, item.progress) : null;
  return (
    <Focusable onPress={() => onPress(item)} style={styles.card}>
      <View style={styles.art}>
        {item.posterUrl !== null && item.posterUrl !== "" ? (
          <Image source={{ uri: item.posterUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <Text style={styles.fallback} numberOfLines={4}>
            {title}
          </Text>
        )}
        {progress !== null && (
          <View style={styles.progress}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
    </Focusable>
  );
});

/** One row: a heading and posters that scroll sideways under the D-pad. Renders nothing when empty. */
export function PosterRow({ title, items, onPress }: { title: string; items: readonly PosterItem[]; onPress: (item: PosterItem) => void }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PosterCard item={item} onPress={onPress} />}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={5}
        contentContainerStyle={styles.rowList}
      />
    </View>
  );
}

const styles = styleSheet({
  row: { gap: space.m, marginBottom: space.l },
  rowTitle: { color: colors.foreground, fontSize: type.lead, fontWeight: "600", paddingLeft: space.s },
  rowList: { gap: space.m, paddingVertical: space.s, paddingHorizontal: space.s },
  card: { width: POSTER_WIDTH, gap: space.s, padding: 4 },
  art: { width: "100%", aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: colors.sunken, overflow: "hidden", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  fallback: { color: colors.muted, fontSize: type.small, padding: space.m, textAlign: "center" },
  title: { color: colors.foreground, fontSize: type.small },
  progress: { position: "absolute", left: 0, right: 0, bottom: 0, height: 5, backgroundColor: "#0008" },
  progressFill: { height: "100%", backgroundColor: colors.accent },
});
