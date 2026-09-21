import { useMemo } from "react";
import { View } from "react-native";
import qrcode from "qrcode-generator";
import { uiScale } from "../theme";

const s = (value: number) => value * uiScale;

/**
 * A QR code drawn from plain views: dark runs on a white square with the quiet border a scanner needs. Nothing is
 * fetched and nothing is sent anywhere; the text is turned into modules right here.
 */
export function QrCode({ text, size }: { text: string; size: number }) {
  const runs = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const found: { row: number; from: number; length: number }[] = [];
    for (let row = 0; row < count; row++) {
      let start = -1;
      for (let col = 0; col <= count; col++) {
        const dark = col < count && qr.isDark(row, col);
        if (dark && start < 0) start = col;
        if (!dark && start >= 0) {
          found.push({ row, from: start, length: col - start });
          start = -1;
        }
      }
    }
    return { count, found };
  }, [text]);
  const quiet = 4;
  const cell = size / (runs.count + quiet * 2);
  return (
    <View style={{ width: s(size), height: s(size), backgroundColor: "#ffffff", borderRadius: s(16) }}>
      {runs.found.map((run, index) => (
        <View key={index} style={{ position: "absolute", left: s((run.from + quiet) * cell), top: s((run.row + quiet) * cell), width: s(run.length * cell) + 0.5, height: s(cell) + 0.5, backgroundColor: "#000000" }} />
      ))}
    </View>
  );
}
