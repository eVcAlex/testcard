/**
 * The way to ask the sync Worker to fetch a provider list (`/relay/list`) for a viewer whose own network blocks the provider.
 * Set by the sync controller while an account is signed in, and cleared on sign-out; `fetchResponding` uses it only after
 * a direct request has failed. Answers `undefined` when it cannot be used (signed out), so the caller keeps the direct error.
 */
export type ListRelay = (url: string, signal: AbortSignal) => Promise<Response | undefined>;

let relay: ListRelay | undefined;

export function setListRelay(next: ListRelay | undefined): void {
  relay = next;
}

export function getListRelay(): ListRelay | undefined {
  return relay;
}

/** How long a provider that needed the relay is sent there first, so a catalogue of hundreds of requests does not wait out a failing direct one each time. */
export const RELAY_FIRST_MS = 10 * 60_000;

const relayFirst = new Map<string, number>();

export function relayFirstFor(host: string, now = Date.now()): boolean {
  const until = relayFirst.get(host);
  if (until === undefined) return false;
  if (until <= now) {
    relayFirst.delete(host);
    return false;
  }
  return true;
}

export function markRelayFirst(host: string, now = Date.now()): void {
  relayFirst.set(host, now + RELAY_FIRST_MS);
}

/** For tests. */
export function resetListRelay(): void {
  relay = undefined;
  relayFirst.clear();
}
