import { useEffect, useState } from "react";
import { BackHandler, Text, TVFocusGuideView, View } from "react-native";
import { Plus } from "iconoir-react-native";
import { useApp } from "../state/app";
import { pinMatches, type Profile } from "../state/profiles";
import { colors, styleSheet, uiScale } from "../theme";
import { Avatar } from "../ui/Avatar";
import { Focusable } from "../ui/Focusable";
import { PinPad } from "../ui/PinPad";
import { ProfileSettings } from "../ui/ProfileSettings";
import { Button } from "../ui/controls";

/** As many as Settings allows. */
const MAX_PROFILES = 6;

/**
 * "Who's watching?": the profiles side by side, opened on launch when there is more than one, and from the profile
 * button in the nav bar. A profile with a PIN asks for it first. `onCancel` is there when someone is already
 * watching (opened from the nav bar): Back returns to them. On launch Back leaves the app.
 */
export function WhoIsWatching({ onDone, onCancel }: { onDone: () => void; onCancel?: (() => void) | undefined }) {
  const { profiles, profile: current, switchProfile } = useApp();
  const [asking, setAsking] = useState<Profile>();
  const [switching, setSwitching] = useState<Profile>();
  // Adding or changing profiles from here, before anyone is chosen: "add" opens straight on a new one's name.
  const [managing, setManaging] = useState<"add" | "edit">();

  useEffect(() => {
    if (managing !== undefined) {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        setManaging(undefined);
        return true;
      });
      return () => subscription.remove();
    }
    if (asking !== undefined) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (onCancel !== undefined) onCancel();
      else BackHandler.exitApp();
      return true;
    });
    return () => subscription.remove();
  }, [asking, onCancel, managing]);

  const open = (profile: Profile) => {
    if (switching !== undefined) return;
    setSwitching(profile);
    void switchProfile(profile.id).finally(onDone);
  };
  const pick = (profile: Profile) => {
    // Coming back to whoever is already in needs no PIN: they never left.
    if (profile.pin !== null && !(onCancel !== undefined && profile.id === current.id)) setAsking(profile);
    else open(profile);
  };

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{"Who's watching?"}</Text>
      <TVFocusGuideView autoFocus style={styles.row}>
        {profiles.map((profile) => (
          <Focusable key={profile.id} preferred={profile.id === current.id} onPress={() => pick(profile)} style={styles.tile} focusedStyle={styles.tileFocused}>
            {({ focused }) => (
              <>
                <View style={[styles.ring, focused && styles.ringFocused]}>
                  <Avatar profile={profile} size={176} />
                </View>
                <Text style={[styles.name, focused && styles.nameFocused]} numberOfLines={1}>
                  {profile.name}
                </Text>
              </>
            )}
          </Focusable>
        ))}
        {profiles.length < MAX_PROFILES ? (
          <Focusable onPress={() => setManaging("add")} style={styles.tile} focusedStyle={styles.tileFocused}>
            {({ focused }) => (
              <>
                <View style={[styles.ring, focused && styles.ringFocused]}>
                  <View style={styles.addDisc}>
                    <Plus color={focused ? colors.foreground : colors.muted} width={Math.round(72 * uiScale)} height={Math.round(72 * uiScale)} strokeWidth={1.5} />
                  </View>
                </View>
                <Text style={[styles.name, focused && styles.nameFocused]}>Add profile</Text>
              </>
            )}
          </Focusable>
        ) : null}
      </TVFocusGuideView>
      {switching !== undefined ? (
        <Text style={styles.switching}>{`Switching to ${switching.name}...`}</Text>
      ) : (
        <Button label="Manage profiles" onPress={() => setManaging("edit")} />
      )}
      {managing !== undefined ? (
        <View style={styles.manage}>
          <View style={styles.manageBody}>
            <ProfileSettings startAdding={managing === "add"} />
          </View>
          <View style={styles.manageFoot}>
            <Button primary label="Done" onPress={() => setManaging(undefined)} />
          </View>
        </View>
      ) : null}
      {asking !== undefined ? (
        <PinPad
          title={`Enter ${asking.name}'s PIN`}
          onEntered={(digits) => {
            if (!pinMatches(asking, digits)) return false;
            setAsking(undefined);
            open(asking);
          }}
          onClose={() => setAsking(undefined)}
        />
      ) : null}
    </View>
  );
}

const styles = styleSheet({
  page: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 35, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: 64 },
  title: { color: colors.foreground, fontSize: 56, fontWeight: "600", letterSpacing: -0.5 },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 36, maxWidth: 1600 },
  tile: { width: 240, alignItems: "center", gap: 20, paddingVertical: 16, borderWidth: 0 },
  tileFocused: { transform: [{ scale: 1.08 }] },
  ring: { padding: 6, borderRadius: 999, borderWidth: 4, borderColor: "transparent" },
  ringFocused: { borderColor: colors.foreground },
  name: { color: colors.muted, fontSize: 28, fontWeight: "500", maxWidth: 240 },
  nameFocused: { color: colors.foreground },
  addDisc: { width: 176, height: 176, borderRadius: 88, borderWidth: 3, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  manage: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 36, backgroundColor: colors.background, paddingHorizontal: 120, paddingTop: 60 },
  manageBody: { flex: 1 },
  switching: { color: colors.muted, fontSize: 26, height: 72, textAlignVertical: "center" },
  manageFoot: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 32 },
});
