/** The Downloader app code that fetches the Android TV and Fire TV apk. Public on purpose. */
export const DOWNLOADER_CODE = "1624205";
export const CONTACT_EMAIL = "hello@evicted.dev";

/** Where the product is in its life. Drives /download and the primary call to action. */
export type ReleaseState = "waitlist" | "beta" | "public";
export const RELEASE_STATE: ReleaseState = "waitlist";
/** Whether the Windows installer is code-signed. false shows the SmartScreen note on /download. */
export const SIGNED = false;
/**
 * Whether the web player (/watch) is switched on for everyone. false keeps it out of the site's copy and links, so the
 * pages do not advertise a feature the Worker still answers 404 for (`WEB_PLAYER` in apps/sync-worker/wrangler.toml).
 * Flip this together with that setting.
 */
export const WEB_PLAYER_LIVE = false;
/** Where the web player lives. A separate page from the site, so link to it with a plain anchor, not the router. */
export const WATCH_HREF = "/watch";

export const SITE_URL = "https://evicted.dev";
export const PRODUCT_NAME = "Testcard";
const PRODUCT_KIND = "IPTV player";
export const PRODUCT_FULL_NAME = `${PRODUCT_NAME} ${PRODUCT_KIND}`;
export const ORG_NAME = "Evicted";
/** The "Join the beta" calls to action all point here (the waitlist form lives on /download). */
export const WAITLIST_HREF = "/download";
