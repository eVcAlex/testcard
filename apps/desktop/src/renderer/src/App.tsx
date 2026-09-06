import { PlayerScreen } from "./player/PlayerScreen.js";

/**
 * Phase 2: playback. A sidebar picks Live / Favourites / Recent; a multi-column channel grid
 * (with search + country chips) picks a channel; choosing one hands the whole window to a
 * fullscreen player where mpv renders into the picture well and a dead channel falls back to
 * Retry / Open in VLC. EPG-driven programme lines + progress bars are a follow-on (XMLTV).
 */
export function App() {
  return <PlayerScreen />;
}
