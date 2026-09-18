import { install } from "react-native-quick-crypto";
import { fetch as streamingFetch } from "expo/fetch";

// `packages/core` uses `crypto.subtle` (PBKDF2, AES-GCM, SHA-1), `crypto.getRandomValues` and
// `crypto.randomUUID`. quick-crypto provides them natively; install() puts them on `globalThis.crypto`.
install();

// Playlists are tens of megabytes and are parsed as they stream in (parseM3U). React Native's
// built-in fetch buffers the whole body, so use Expo's streaming, standards-compliant fetch.
globalThis.fetch = streamingFetch as unknown as typeof fetch;
