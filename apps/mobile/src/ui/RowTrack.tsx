import type { ReactNode } from "react";
import { TVFocusGuideView } from "react-native";

/**
 * Holds one sideways row of cards for the remote. Left and Right stay in the row: at its last card, Right used to
 * make Android look across the whole screen and land on whichever card in another row lay furthest right (the end
 * of New Releases from the end of My List, jumping the Top 10). And the row is one target for Up and Down, so they
 * always move exactly one row, back onto the card the viewer was last on in it, rather than onto whichever card of
 * whichever row happens to sit nearest.
 */
export function RowTrack({ children, leftExits = false }: { children: ReactNode; /** Left from the first card may leave the row (to a panel beside it). */ leftExits?: boolean }) {
  return (
    <TVFocusGuideView autoFocus trapFocusLeft={!leftExits} trapFocusRight>
      {children}
    </TVFocusGuideView>
  );
}
