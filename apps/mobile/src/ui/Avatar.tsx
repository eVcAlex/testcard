import { Text, View } from "react-native";
import { Lock } from "iconoir-react-native";
import { profileColour, type Profile } from "../state/profiles";
import { colors, styleSheet, uiScale } from "../theme";

/** A profile's disc: its colour and the first letter of its name, with a small lock when it has a PIN. `size` is in 1920 px design units. */
export function Avatar({ profile, size }: { profile: Profile; size: number }) {
  const scaled = Math.round(size * uiScale);
  const lock = Math.round(size * 0.22 * uiScale);
  return (
    <View style={{ width: scaled, height: scaled }}>
      <View style={[styles.disc, { width: scaled, height: scaled, borderRadius: scaled / 2, backgroundColor: profileColour(profile) }]}>
        <Text style={[styles.initial, { fontSize: Math.round(size * 0.44 * uiScale) }]}>{profile.name.trim().charAt(0).toUpperCase() || "?"}</Text>
      </View>
      {profile.pin !== null ? (
        <View style={[styles.lock, { width: lock * 1.8, height: lock * 1.8, borderRadius: lock }]}>
          <Lock color={colors.foreground} width={lock} height={lock} strokeWidth={2} />
        </View>
      ) : null}
    </View>
  );
}

const styles = styleSheet({
  disc: { alignItems: "center", justifyContent: "center" },
  initial: { color: colors.accentInk, fontWeight: "600" },
  lock: { position: "absolute", right: -4, bottom: -4, alignItems: "center", justifyContent: "center", backgroundColor: colors.raised, borderWidth: 2, borderColor: colors.background },
});
