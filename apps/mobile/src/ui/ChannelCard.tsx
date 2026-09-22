import { memo } from "react";
import { FlatList, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, space, styleSheet } from "../theme";
import { Focusable } from "./Focusable";
import { PinBadge } from "./PinBadge";
import type { PosterItem } from "./Poster";

/** A channel on a landing row: its logo on a panel, its name beneath. Sits beside the poster cards, drawn the same way. */
export interface ChannelItem extends PosterItem {
  /** Its number in the lineup, when it has one. */
  readonly channelNumber?: number | null;
}

const CARD_WIDTH = 300;

export const ChannelCard = memo(function ChannelCard({
  item,
  onPress,
  onFocusItem,
}: {
  item: ChannelItem;
  onPress: (item: ChannelItem) => void;
  onFocusItem?: ((item: ChannelItem) => void) | undefined;
}) {
  return (
    <Focusable onPress={() => onPress(item)} onFocus={onFocusItem !== undefined ? () => onFocusItem(item) : undefined} style={styles.card} focusedStyle={styles.cardFocused}>
      {({ focused }) => (
        <>
          <View style={[styles.art, focused && styles.artFocused]}>
            {item.posterUrl !== null && item.posterUrl !== "" ? (
              <Image source={{ uri: item.posterUrl }} style={styles.logo} contentFit="contain" cachePolicy="memory-disk" recyclingKey={item.id} />
            ) : (
              <Text style={styles.fallback} numberOfLines={2}>
                {item.name}
              </Text>
            )}
            {item.channelNumber !== undefined && item.channelNumber !== null ? (
              <View style={styles.number}>
                <Text style={styles.numberText}>{item.channelNumber}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.title, focused && styles.titleFocused]} numberOfLines={2}>
            {item.name}
          </Text>
        </>
      )}
    </Focusable>
  );
});

/** One row of channel cards that scrolls sideways under the D-pad. Renders nothing when empty. */
export const ChannelShelf = memo(function ChannelShelf({
  title,
  items,
  onPress,
  onFocusItem,
  pinned = false,
}: {
  title: string;
  items: readonly ChannelItem[];
  onPress: (item: ChannelItem) => void;
  onFocusItem?: ((item: ChannelItem) => void) | undefined;
  pinned?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>{title}</Text>
        {pinned ? <PinBadge /> : null}
      </View>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ChannelCard item={item} onPress={onPress} onFocusItem={onFocusItem} />}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={6}
        windowSize={5}
        contentContainerStyle={styles.rowList}
      />
    </View>
  );
});

const styles = styleSheet({
  row: { gap: space.m, marginBottom: space.l },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 16 },
  rowTitle: { color: colors.foreground, fontSize: 32, fontWeight: "600", letterSpacing: -0.3, paddingLeft: space.s },
  rowList: { gap: space.m, paddingVertical: space.s, paddingHorizontal: space.s },
  card: { width: CARD_WIDTH, gap: 10, padding: 4 },
  cardFocused: { borderColor: "transparent" },
  art: { width: "100%", aspectRatio: 16 / 9, borderWidth: 3, borderColor: "transparent", borderRadius: 12, backgroundColor: colors.raised, overflow: "hidden", alignItems: "center", justifyContent: "center", padding: 12 },
  artFocused: { borderColor: colors.accent },
  logo: { width: "100%", height: "100%" },
  fallback: { color: colors.muted, fontSize: 22, textAlign: "center" },
  number: { position: "absolute", right: 8, top: 8, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 6, backgroundColor: "#000000b3" },
  numberText: { color: colors.foreground, fontSize: 17, fontWeight: "600" },
  title: { color: colors.muted, fontSize: 21 },
  titleFocused: { color: colors.foreground },
});
