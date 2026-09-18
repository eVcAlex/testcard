import { useMemo, useState } from "react";
import { FlatList, Image, StyleSheet, Text, View } from "react-native";
import { categoryLabel } from "@testcard/core/src/normalise/categoryLabel.js";
import { browseChannels, listCategories, type ChannelRow } from "@testcard/core/src/db/queries.js";
import { useApp } from "../state/app";
import { colors, space, type } from "../theme";
import { Muted } from "../ui/controls";
import { Focusable } from "../ui/Focusable";

/**
 * Live TV: category chips across the top, channels below. Categories that are only dividers or
 * decoration (the classifier's junk/separator flags) are left out; nothing is hidden from the data.
 * No guide yet on the TV app: channels show their name and number.
 */
export function LiveScreen({ onPlay }: { onPlay: (channel: { id: string; title: string }) => void }) {
  const { db, version } = useApp();
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const categories = useMemo(() => {
    void version;
    return listCategories(db).filter((category) => !category.tags.split(" ").some((tag) => tag === "junk" || tag === "separator" || tag === "adult"));
  }, [db, version]);
  const channels = useMemo(() => {
    void version;
    return browseChannels(db, { ...(categoryId !== null ? { categoryId } : {}), limit: 300 });
  }, [db, version, categoryId]);

  if (categories.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No channels yet</Text>
        <Muted>Sources that sync from your account load here. Open Sources to see progress.</Muted>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <FlatList
        horizontal
        data={[{ id: null as string | null, name: "All channels" }, ...categories.map((category) => ({ id: category.id as string | null, name: categoryLabel(category.name) }))]}
        keyExtractor={(item) => item.id ?? "all"}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        renderItem={({ item }) => (
          <Focusable onPress={() => setCategoryId(item.id)} style={[styles.chip, item.id === categoryId && styles.chipActive]}>
            <Text style={[styles.chipLabel, item.id === categoryId && styles.chipLabelActive]}>{item.name}</Text>
          </Focusable>
        )}
      />
      <FlatList
        data={channels}
        keyExtractor={(channel) => channel.id}
        numColumns={2}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.columns}
        initialNumToRender={12}
        renderItem={({ item }) => <ChannelTile channel={item} onPress={() => onPlay({ id: item.id, title: item.normalised_name })} />}
      />
    </View>
  );
}

function ChannelTile({ channel, onPress }: { channel: ChannelRow; onPress: () => void }) {
  return (
    <Focusable onPress={onPress} style={styles.tile}>
      <View style={styles.logo}>
        {channel.logo_url !== null && channel.logo_url !== "" ? <Image source={{ uri: channel.logo_url }} style={styles.logoImage} resizeMode="contain" /> : null}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {channel.normalised_name}
      </Text>
    </Focusable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: space.m },
  chips: { gap: space.m, paddingVertical: space.s, paddingHorizontal: space.s },
  chip: { paddingVertical: space.s, paddingHorizontal: space.l, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.accentSoft },
  chipLabel: { color: colors.muted, fontSize: type.small },
  chipLabelActive: { color: colors.accent },
  list: { paddingHorizontal: space.s, paddingBottom: space.xl },
  columns: { gap: space.m },
  tile: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.m, padding: space.m, backgroundColor: colors.card, marginBottom: space.m },
  logo: { width: 72, height: 54, borderRadius: 6, backgroundColor: colors.sunken, overflow: "hidden" },
  logoImage: { width: "100%", height: "100%" },
  name: { flex: 1, color: colors.foreground, fontSize: type.body },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.m, padding: space.xl },
  emptyTitle: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
});
