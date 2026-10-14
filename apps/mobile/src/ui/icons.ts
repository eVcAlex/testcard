// oxlint-disable-next-line no-restricted-imports -- a type only, erased from the bundle
import type { Search as IconComponent } from "iconoir-react-native";

// The icons this app draws, each loaded from its own file. The package's barrel ("iconoir-react-native") requires every
// one of its ~1,670 icons when it loads, and Metro does not tree-shake, so importing it made the icon set the largest
// thing in the bundle. metro.config.js lets these per-icon paths through (the package's exports map hides them), and
// .oxlintrc.json refuses an import of the barrel. Add an icon here before using it.
type Icon = typeof IconComponent;
const icon = (mod: { default: Icon }): Icon => mod.default;

export const ArrowLeft = icon(require("iconoir-react-native/dist/regular/ArrowLeft.js"));
export const Backward15Seconds = icon(require("iconoir-react-native/dist/regular/Backward15Seconds.js"));
export const Check = icon(require("iconoir-react-native/dist/regular/Check.js"));
export const ClosedCaptionsTag = icon(require("iconoir-react-native/dist/regular/ClosedCaptionsTag.js"));
export const DashboardSpeed = icon(require("iconoir-react-native/dist/regular/DashboardSpeed.js"));
export const Erase = icon(require("iconoir-react-native/dist/regular/Erase.js"));
export const Eye = icon(require("iconoir-react-native/dist/regular/Eye.js"));
export const EyeClosed = icon(require("iconoir-react-native/dist/regular/EyeClosed.js"));
export const Forward15Seconds = icon(require("iconoir-react-native/dist/regular/Forward15Seconds.js"));
export const Headset = icon(require("iconoir-react-native/dist/regular/Headset.js"));
export const InfoCircle = icon(require("iconoir-react-native/dist/regular/InfoCircle.js"));
export const Lock = icon(require("iconoir-react-native/dist/regular/Lock.js"));
export const Movie = icon(require("iconoir-react-native/dist/regular/Movie.js"));
export const MultiplePages = icon(require("iconoir-react-native/dist/regular/MultiplePages.js"));
export const NavArrowDown = icon(require("iconoir-react-native/dist/regular/NavArrowDown.js"));
export const NavArrowLeft = icon(require("iconoir-react-native/dist/regular/NavArrowLeft.js"));
export const NavArrowRight = icon(require("iconoir-react-native/dist/regular/NavArrowRight.js"));
export const Pause = icon(require("iconoir-react-native/dist/regular/Pause.js"));
export const Play = icon(require("iconoir-react-native/dist/regular/Play.js"));
export const Plus = icon(require("iconoir-react-native/dist/regular/Plus.js"));
export const Restart = icon(require("iconoir-react-native/dist/regular/Restart.js"));
export const ScaleFrameEnlarge = icon(require("iconoir-react-native/dist/regular/ScaleFrameEnlarge.js"));
export const Search = icon(require("iconoir-react-native/dist/regular/Search.js"));
export const Settings = icon(require("iconoir-react-native/dist/regular/Settings.js"));
export const SkipNext = icon(require("iconoir-react-native/dist/regular/SkipNext.js"));
export const WarningCircle = icon(require("iconoir-react-native/dist/regular/WarningCircle.js"));
export const Xmark = icon(require("iconoir-react-native/dist/regular/Xmark.js"));
