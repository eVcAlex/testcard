import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { accountProblem } from "../../state/account";
import { plainReason, serverGone } from "../../ui/plainReason";
import { SourceForm } from "../../ui/SourceForm";
import { colors, space, styleSheet } from "../../theme";
import { Button } from "../../ui/controls";

export function Failure({ title, message: given, detail, onRetry, onExit, sourceId, raw = "", editSourceId }: { title: string; message: string; detail?: string; onRetry?: () => void; onExit: () => void; sourceId?: string | null; raw?: string; editSourceId?: string | null }) {
  // A server name that no longer exists is nearly always a provider that moved: say so, and offer to put it right.
  const gone = serverGone(raw) && editSourceId != null;
  const [editing, setEditing] = useState(false);
  // A refused stream is often the account (every stream it allows in use, or it has ended): the provider says which.
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (sourceId === undefined || sourceId === null) return;
    let live = true;
    void accountProblem(sourceId).then((found) => live && setProblem(found));
    return () => {
      live = false;
    };
  }, [sourceId]);
  const message = gone ? plainReason(raw) : (problem ?? given);
  return (
    <View style={styles.centre}>
      {editing && editSourceId != null ? (
        <SourceForm
          sourceId={editSourceId}
          onClose={() => {
            setEditing(false);
            onRetry?.();
          }}
        />
      ) : null}
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.error}>{message}</Text>
      {!gone && detail !== undefined && detail !== "" ? (
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
      <View style={styles.row}>
        {gone ? <Button preferred label="Edit source" onPress={() => setEditing(true)} /> : null}
        {onRetry !== undefined ? <Button label="Try again" onPress={onRetry} /> : null}
        <Button preferred={!gone} label="Back" onPress={onExit} />
      </View>
    </View>
  );
}

/** The device's decoder said no (a 4K or 10-bit stream on hardware that cannot do it) or the network did. */
export function explain(raw: string): string {
  if (/EXCEEDS_CAPABILITIES|MediaCodec|Decoder|decoder/i.test(raw)) return "This device can't decode this video (its format or resolution is beyond the hardware).";
  if (/40[13]/.test(raw)) return "The provider refused this stream.";
  if (/404|410/.test(raw)) return "The provider has no stream at that address (it may have been removed).";
  if (serverGone(raw)) return plainReason(raw);
  if (/Unable to connect|timeout|timed out|Network|ConnectException/i.test(raw)) return "Couldn't reach the stream. Check the connection and try again.";
  return "This couldn't be played.";
}

const styles = styleSheet({
  centre: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: space.l, padding: space.xl },
  row: { flexDirection: "row", gap: space.m },
  title: { color: colors.foreground, fontSize: 44, fontWeight: "600", letterSpacing: -0.5, textAlign: "center", maxWidth: 1200 },
  error: { color: colors.muted, fontSize: 30, textAlign: "center", maxWidth: 1000, lineHeight: 44 },
  detail: { color: colors.faint, fontSize: 20, textAlign: "center", maxWidth: 1000 },
});
