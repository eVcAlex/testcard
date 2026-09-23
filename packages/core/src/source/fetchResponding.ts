/** How long a provider gets to start answering before the request is given up. */
export const RESPONSE_TIMEOUT_MS = 20_000;

/**
 * `fetch` that gives up when the provider has not started answering within `timeoutMs`. Without it a stalled
 * provider leaves a screen on "Loading..." for good. Only the wait for the response is bounded: once it has
 * started, the body (a whole catalogue can be many megabytes on a slow Fire Stick) takes as long as it takes.
 */
export async function fetchResponding(url: string, init: RequestInit = {}, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The provider did not respond. Try again in a moment.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
