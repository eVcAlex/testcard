export const CONTACT_EMAIL = "hello@evicted.dev";

/** Where the product is in its life. Drives /download and the primary call to action. */
export type ReleaseState = "waitlist" | "beta" | "public";
export const RELEASE_STATE: ReleaseState = "waitlist";
/** Whether the Windows installer is code-signed. false shows the SmartScreen note on /download. */
export const SIGNED = false;

export const SITE_URL = "https://evicted.dev";
export const PRODUCT_NAME = "Testcard";
const PRODUCT_KIND = "IPTV player";
export const PRODUCT_FULL_NAME = `${PRODUCT_NAME} ${PRODUCT_KIND}`;
export const ORG_NAME = "Evicted";
/** The "Join the beta" calls to action all point here (the waitlist form lives on /download). */
export const WAITLIST_HREF = "/download#waitlist";
