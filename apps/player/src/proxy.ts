/** An address as the browser must ask for it: through the Worker's stream proxy, which carries the session cookie. */
export const viaProxy = (address: string): string => `/watch/p?u=${encodeURIComponent(address)}`;
