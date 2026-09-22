import { memo } from "react";
import { StyleSheet, View } from "react-native";

const DIRECTION = { left: "to right", top: "to bottom", bottom: "to top" } as const;

/**
 * The page colour fading out from one edge: solid at the named edge, clear at the far side. One native
 * gradient view, drawn once, so it costs nothing while the remote moves.
 */
export const Fade = memo(function Fade({ from, strength = 1 }: { from: "left" | "top" | "bottom"; strength?: number }) {
  const solid = `rgba(10,13,17,${strength})`;
  const soft = `rgba(10,13,17,${(strength * 0.55).toFixed(2)})`;
  return <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: `linear-gradient(${DIRECTION[from]}, ${solid} 0%, ${soft} 45%, rgba(10,13,17,0) 100%)` }]} pointerEvents="none" />;
});
