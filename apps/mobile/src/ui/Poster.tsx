import { createContext, memo, useContext } from "react";
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

const POSTER_WIDTH = 200;

/**
 * Source names by id, provided while the lists mix more than one source, so each poster can say where it is from.
 * Null when only one source is showing, where the label would be noise. Item ids start with their source id.
 */
export const SourceNames = createContext<ReadonlyMap<string, string> | null>(null);
const sourceOf = (id: string): string => id.slice(0, Math.max(0, id.indexOf(":")));

export const POSTER_ART_WIDTH = POSTER_WIDTH;

/** A poster and its title. `grid` lets it share a grid row with its neighbours instead of keeping a fixed width. */
export const PosterCard = memo(function PosterCard({
  item,
  onPress,
  onFocusItem,
  grid = false,
}: {
  item: PosterItem;
  onPress: (item: PosterItem) => void;
  /** Called when the remote lands on this poster (the landing page's hero follows it). */
  onFocusItem?: (item: PosterItem) => void;
  grid?: boolean;
}) {
  const { title, is4k } = splitTitle(item.name);
  const sourceName = useContext(SourceNames)?.get(sourceOf(item.id));
  const progress = item.progress !== undefined && item.progress !== null && item.progress > 0 ? Math.min(1, item.progress) : null;
  return (
    <Focusable onPress={() => onPress(item)} onFocus={onFocusItem !== undefined ? () => onFocusItem(item) : undefined} style={grid ? styles.cardGrid : styles.card} focusedStyle={styles.cardFocused}>
      {({ focused }) => (
        <>
      <View style={[styles.art, focused && styles.artFocused]}>
        {item.posterUrl !== null && item.posterUrl !== "" ? (
          <Image source={{ uri: item.posterUrl }} style={styles.image} resizeMode="cover" resizeMethod="resize" fadeDuration={0} />
        ) : (
          <Text style={styles.fallback} numberOfLines={4}>
            {title}
          </Text>
        )}
        {is4k && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>4K</Text>
          </View>
        )}
        {sourceName !== undefined && (
          <View style={styles.source}>
            <Text style={styles.sourceText} numberOfLines={1}>
              {sourceName}
            </Text>
          </View>
        )}
        {progress !== null && (
          <View style={styles.progress}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        )}
      </View>
      <Text style={[styles.title, focused && styles.titleFocused]} numberOfLines={2}>
        {title}
      </Text>
        </>
      )}
    </Focusable>
  );
});

/** One row: a heading and posters that scroll sideways under the D-pad. Renders nothing when empty. */
export const PosterRow = memo(function PosterRow({
  title,
  items,
  onPress,
  onFocusItem,
}: {
  title: string;
  items: readonly PosterItem[];
  onPress: (item: PosterItem) => void;
  onFocusItem?: (item: PosterItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PosterCard item={item} onPress={onPress} {...(onFocusItem !== undefined ? { onFocusItem } : {})} />}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={5}
        contentContainerStyle={styles.rowList}
      />
    </View>
  );
});

const styles = styleSheet({
  row: { gap: space.m, marginBottom: space.l },
  rowTitle: { color: colors.foreground, fontSize: 32, fontWeight: "600", letterSpacing: -0.3, paddingLeft: space.s },
  rowList: { gap: space.m, paddingVertical: space.s, paddingHorizontal: space.s },
  card: { width: POSTER_WIDTH, gap: 10, padding: 4 },
  cardGrid: { flex: 1, gap: 10, padding: 4 },
  cardFocused: { borderColor: "transparent" },
  artFocused: { borderColor: colors.accent },
  art: { width: "100%", aspectRatio: 2 / 3, borderWidth: 3, borderColor: "transparent", borderRadius: 12, backgroundColor: colors.raised, overflow: "hidden", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  fallback: { color: colors.muted, fontSize: type.small, padding: space.m, textAlign: "center" },
  title: { color: colors.muted, fontSize: 21 },
  titleFocused: { color: colors.foreground },
  badge: { position: "absolute", left: 10, top: 10, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, backgroundColor: "#000000b3" },
  badgeText: { color: colors.foreground, fontSize: 17, fontWeight: "600", letterSpacing: 0.5 },
  source: { position: "absolute", left: 10, bottom: 14, maxWidth: "85%", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, backgroundColor: "#000000b3" },
  sourceText: { color: colors.foreground, fontSize: 17, fontWeight: "600" },
  progress: { position: "absolute", left: 0, right: 0, bottom: 0, height: 5, backgroundColor: "#0008" },
  progressFill: { height: "100%", backgroundColor: colors.accent },
});
