import { install } from "react-native-quick-crypto";
import { fetch as streamingFetch } from "expo/fetch";

// `packages/core` uses `crypto.subtle` (PBKDF2, AES-GCM, SHA-1), `crypto.getRandomValues` and
// `crypto.randomUUID`. quick-crypto provides them natively; install() puts them on `globalThis.crypto`.
install();

// Playlists are tens of megabytes and are parsed as they stream in (parseM3U). React Native's
// built-in fetch buffers the whole body, so use Expo's streaming, standards-compliant fetch.
// Providers filter on User-Agent. The desktop app's requests go out as Node's fetch ("node") and work, so
// send the same rather than the Android HTTP stack's default.
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
  streamingFetch(input as never, init?.headers === undefined ? { ...(init as object), headers: { "user-agent": "node" } } : (init as never))) as unknown as typeof fetch;
