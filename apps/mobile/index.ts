// Polyfills first: core relies on WebCrypto (sync encryption, remote keys) which Hermes lacks.
import "./src/platform/polyfills";
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
