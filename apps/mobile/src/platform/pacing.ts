import { useTVEventHandler } from "react-native";
import { setSlicePause } from "@testcard/core/src/db/applyInSlices.js";

/** A key press within this long ago means the viewer is moving around: an import waits its turn. */
const BUSY_FOR_MS = 600;
const WAIT_MS = 120;
let lastKeyAt = 0;

setSlicePause(() => (Date.now() - lastKeyAt < BUSY_FOR_MS ? WAIT_MS : 0));

/**
 * Notes every press of the remote, so a source import running in the background (which shares the UI's thread)
 * steps aside while the viewer is scrolling instead of making each press land late. Mounted once, at the root.
 */
export function useImportPacing(): void {
  useTVEventHandler(() => {
    lastKeyAt = Date.now();
  });
}
