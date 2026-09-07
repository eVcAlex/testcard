import { PlayerScreen } from "./player/PlayerScreen.js";

/**
 * The whole app: a sidebar picks Live / Guide / Favourites / Recent (and a category); a
 * multi-column channel grid or the timeline guide picks a channel; choosing one hands the
 * whole window to a fullscreen player where mpv renders into the picture well, with an
 * on-video overlay for transport + aspect ratio and a Retry / Open in VLC dead-channel state.
 * XMLTV EPG (now/next lines, progress bars, the guide) imports on source refresh.
 */
export function App() {
  return <PlayerScreen />;
}
