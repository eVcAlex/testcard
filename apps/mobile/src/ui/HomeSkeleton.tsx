import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { colors, styleSheet, uiScale } from "../theme";

/** Inline sizes are not scaled like a stylesheet's, so the bars below are sized through this. */
const bar = (width: number, height: number, extra: { marginTop?: number; marginLeft?: number; borderRadius?: number } = {}) => ({
  width: Math.round(width * uiScale),
  height: Math.round(height * uiScale),
  ...(extra.marginTop !== undefined ? { marginTop: Math.round(extra.marginTop * uiScale) } : {}),
  ...(extra.marginLeft !== undefined ? { marginLeft: Math.round(extra.marginLeft * uiScale) } : {}),
  ...(extra.borderRadius !== undefined ? { borderRadius: Math.round(extra.borderRadius * uiScale) } : {}),
});

/**
 * A grey outline of the landing page (hero text, buttons, a row of posters) shown while the rows are built for
 * the first time, so the screen has its shape straight away instead of a blank with a word on it. The pulse
 * runs natively, so it keeps going while the rows are being worked out.
 */
export function HomeSkeleton() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 1, 0.5] });
  return (
    <Animated.View style={[styles.screen, { opacity }]} pointerEvents="none">
      <View style={styles.hero}>
        <View style={[styles.bar, bar(200, 22)]} />
        <View style={[styles.bar, bar(760, 64, { marginTop: 18 })]} />
        <View style={[styles.bar, bar(420, 32, { marginTop: 22 })]} />
        <View style={[styles.bar, bar(980, 30, { marginTop: 18 })]} />
        <View style={[styles.bar, bar(240, 70, { marginTop: 26, borderRadius: 35 })]} />
      </View>
      <View style={[styles.bar, bar(320, 32, { marginLeft: 52 })]} />
      <View style={styles.row}>
        {Array.from({ length: 8 }, (_, index) => (
          <View key={index} style={styles.poster} />
        ))}
      </View>
    </Animated.View>
  );
}

const styles = styleSheet({
  screen: { flex: 1, paddingTop: 112 },
  hero: { height: 408, paddingLeft: 52, paddingTop: 20 },
  bar: { borderRadius: 10, backgroundColor: colors.cardActive },
  row: { flexDirection: "row", gap: 24, paddingLeft: 52, paddingTop: 24 },
  poster: { width: 200, height: 300, borderRadius: 12, backgroundColor: colors.card },
});
