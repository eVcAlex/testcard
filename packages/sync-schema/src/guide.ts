/**
 * Public TV guides (XMLTV files). A device tells the Worker the address of each one its sources use; a daily job
 * reads them, keeps the next day and a half, and puts a small file per address where every device can fetch it, so a
 * Fire TV need not unpack and parse a 200 MB guide itself.
 *
 * Only addresses that carry no login are shared. A credentialed one (Xtream's `xmltv.php?username=...`, a private
 * link) fails `isSharableGuideUrl` and stays on the device, read the slow way.
 */

const MOST_URL_LENGTH = 500;

/** Whether the address is one a device may register and the job may fetch: a plain https link to a guide file. */
export function isSharableGuideUrl(address: string): boolean {
  if (address.length > MOST_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return false;
  // Not a machine's own address: the job fetches whatever is registered.
  if (url.hostname === "localhost" || url.hostname.endsWith(".local") || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":")) return false;
  return /\.(xml|xml\.gz|gz)$/i.test(url.pathname);
}

/** The name a guide's file is kept under: the same on the device, in the Worker and in the job. */
export async function guideFileName(address: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `guide-${hex.slice(0, 32)}.json`;
}

/**
 * What the job writes and a device reads. `c` maps each XMLTV channel id to its programmes as
 * `[start, end, title]` (epoch ms), in start order; descriptions are left out, nothing shows them.
 */
export interface GuideFile {
  /** When the job read the source guide (epoch ms). */
  readonly at: number;
  readonly c: Readonly<Record<string, readonly (readonly [number, number, string])[]>>;
}
