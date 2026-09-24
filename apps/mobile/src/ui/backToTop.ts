import { createContext } from "react";

/**
 * Bumped when Back sends the remote from a page up to the nav bar. A landing page takes it as "start again from
 * the top": its rows scroll back up and the hero returns to the first title, so Down from the nav bar lands at the
 * top of the page rather than on the row the viewer left, many rows down.
 */
export const BackToTop = createContext(0);
