import { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { colors, styleSheet, uiScale } from "../theme";
import type { SetupProgress } from "../state/setup";

/** Bar length in design units; the fill is a full-length bar scaled from its left edge so a native animation can drive it. */
const BAR = 1200;

/**
 * The screen the app shows while it fetches your data for the first time or refreshes a source. The rest of
 * the app is not drawn behind it, so there is nothing to navigate to until it is done. The motion runs on
 * the native side, so it keeps moving while an import is busy on the JavaScript thread.
 */
export function SetupOverlay({ setup, hint }: { setup: SetupProgress; hint: string | null }) {
  const fill = useRef(new Animated.Value(setup.fraction)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fill, { toValue: setup.fraction, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [fill, setup.fraction]);
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [sweep]);
  const width = BAR * uiScale;
  return (
    <View style={styles.screen}>
      <View style={styles.kickerRow}>
        <View style={styles.dot} />
        <Text style={styles.kicker}>SETTING UP</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>Getting Testcard ready...</Text>
        <View style={[styles.track, { width }]}>
          <Animated.View style={[styles.fill, { width, transform: [{ translateX: -width / 2 }, { scaleX: fill }, { translateX: width / 2 }] }]} />
          <Animated.View style={[styles.glint, { transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-160 * uiScale, width] }) }] }]} />
        </View>
        <View style={[styles.detailRow, { width }]}>
          <Text style={styles.detail} numberOfLines={1}>
            {setup.detail}
          </Text>
          <Text style={styles.detail}>{`${Math.round(setup.fraction * 100)} %`}</Text>
        </View>
        <View style={styles.steps}>
          {setup.steps.map((step) => (
            <View key={step.label} style={styles.step}>
              <View style={[styles.ring, step.state === "done" && styles.ringDone, step.state === "active" && styles.ringActive]}>
                {step.state === "done" ? <Text style={styles.tick}>{"✓"}</Text> : null}
              </View>
              <Text style={[styles.stepLabel, step.state === "waiting" && styles.stepWaiting, step.state === "done" && styles.stepDone]}>{step.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.note}>You can use the app as soon as this finishes.</Text>
      </View>
      {hint !== null ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{hint}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = styleSheet({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 120, paddingTop: 90 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accent },
  kicker: { color: colors.muted, fontSize: 22, fontWeight: "500", letterSpacing: 3 },
  body: { flex: 1, justifyContent: "center", gap: 28, paddingBottom: 120 },
  title: { color: colors.foreground, fontSize: 68, fontWeight: "600", letterSpacing: -1.5 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.cardActive, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  glint: { position: "absolute", top: 0, width: 160, height: 8, backgroundColor: "#ffffff40" },
  detailRow: { flexDirection: "row", justifyContent: "space-between" },
  detail: { color: colors.muted, fontSize: 26 },
  steps: { gap: 22, marginTop: 24 },
  step: { flexDirection: "row", alignItems: "center", gap: 24 },
  ring: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: colors.cardActive, alignItems: "center", justifyContent: "center" },
  ringActive: { borderColor: colors.accent },
  ringDone: { borderColor: colors.accent },
  tick: { color: colors.accent, fontSize: 24, fontWeight: "600" },
  stepLabel: { color: colors.foreground, fontSize: 32 },
  stepWaiting: { color: colors.faint },
  stepDone: { color: colors.foreground },
  note: { color: colors.faint, fontSize: 24, marginTop: 24 },
  toast: { position: "absolute", left: 0, right: 0, bottom: 60, alignItems: "center" },
  toastText: { color: colors.foreground, fontSize: 26, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 999, backgroundColor: "#000000d9", overflow: "hidden" },
});
