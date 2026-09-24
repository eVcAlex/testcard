/**
 * Provider list requests, a few at a time. A provider's catalogue is one request per category (hundreds of them);
 * one after another, a refresh spent most of its time waiting on round trips. A few at once is what the provider
 * panels themselves do, and stays well under what they allow.
 */
export const LIST_REQUESTS_AT_ONCE = 4;

/** `fetch` over every item, `limit` at a time, with the results in the items' order. The first failure is thrown. */
export async function fetchAll<T, R>(items: readonly T[], fetch: (item: T) => Promise<R>, limit = LIST_REQUESTS_AT_ONCE): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fetch(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
