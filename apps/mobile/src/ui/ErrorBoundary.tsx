import { Component, type ReactNode } from "react";
import { Text, View } from "react-native";
import { colors, styleSheet } from "../theme";
import { Button } from "./controls";

/**
 * Catches a render error anywhere below it. Without one, a thrown error leaves a blank screen the remote cannot get
 * out of. "Try again" mounts the whole tree afresh (the state it held is dropped, the database and sync are reopened).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.log(`[crash] ${error.message}`);
  }

  render() {
    if (this.state.error === null) return <View style={styles.fill} key={this.state.attempt}>{this.props.children}</View>;
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.detail}>{this.state.error.message}</Text>
        <Button label="Try again" primary preferred onPress={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))} />
      </View>
    );
  }
}

const styles = styleSheet({
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: 24, paddingHorizontal: 120 },
  title: { color: colors.foreground, fontSize: 40, fontWeight: "600" },
  detail: { color: colors.faint, fontSize: 22, textAlign: "center" },
});
