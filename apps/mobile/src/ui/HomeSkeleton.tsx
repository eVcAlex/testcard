import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { colors, styleSheet } from "../theme";

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
        <View style={[styles.bar, { width: 200, height: 22 }]} />
        <View style={[styles.bar, { width: 760, height: 64, marginTop: 18 }]} />
        <View style={[styles.bar, { width: 420, height: 32, marginTop: 22 }]} />
        <View style={[styles.bar, { width: 980, height: 30, marginTop: 18 }]} />
        <View style={[styles.bar, { width: 240, height: 70, borderRadius: 35, marginTop: 26 }]} />
      </View>
      <View style={[styles.bar, { width: 320, height: 32, marginLeft: 52 }]} />
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
