import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useApp } from "../state/app";
import { readSwitchOnBuffering, writeSwitchOnBuffering } from "../playback/bufferSwitch";
import { space, styleSheet } from "../theme";
import { Button, Heading, Muted } from "./controls";

/** The playback pane of Settings: for now, whether a buffering live channel moves on to its next feed. */
export function PlaybackSettings() {
  const { db } = useApp();
  const [on, setOn] = useState(() => readSwitchOnBuffering(db));
  const toggle = () => {
    writeSwitchOnBuffering(db, !on);
    setOn(!on);
  };
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Heading>Playback</Heading>
      <Muted>When a live channel stops to buffer for a few seconds, switch to another feed of the same channel (another quality or copy) if there is one. Off: it keeps reloading the same feed.</Muted>
      <View style={styles.row}>
        <Button label={on ? "Switch feed when it buffers: On" : "Switch feed when it buffers: Off"} onPress={toggle} primary={on} />
      </View>
    </ScrollView>
  );
}

const styles = styleSheet({
  page: { padding: space.xl, gap: space.m },
  row: { flexDirection: "row" },
});
