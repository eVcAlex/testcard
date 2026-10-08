// Server-only (prerender): JSON-LD documents per route. Kept out of routes-meta.ts so the client bundle never carries them.
import { faqLdItems } from "./faq-data.ts";
import { type HeadModel, type RouteMeta, headModel } from "./routes-meta.ts";
import { CONTACT_EMAIL, ORG_NAME, PRODUCT_FULL_NAME, SITE_URL } from "./site.ts";

const ORG_ID = `${SITE_URL}/#org`;
const SITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#app`;

export const organizationLd = () => ({
  "@type": "Organization",
  "@id": ORG_ID,
  name: ORG_NAME,
  url: `${SITE_URL}/`,
  email: CONTACT_EMAIL,
});

export const websiteLd = () => ({
  "@type": "WebSite",
  "@id": SITE_ID,
  url: `${SITE_URL}/`,
  name: PRODUCT_FULL_NAME,
  publisher: { "@id": ORG_ID },
});

export const softwareApplicationLd = () => ({
  "@type": "SoftwareApplication",
  "@id": APP_ID,
  name: PRODUCT_FULL_NAME,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Windows, Fire OS",
  url: `${SITE_URL}/`,
  description: "A tidy IPTV player for Windows and Fire TV. You add your own Xtream or M3U sources; it ships no channels.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@id": ORG_ID },
});

/** One JSON-LD document with the three home-page entities. */
export const homeLd = () => [{ "@context": "https://schema.org", "@graph": [organizationLd(), websiteLd(), softwareApplicationLd()] }];

/** Pass only answers that are timeless: never legality, pricing or version-specific ones. */
export const faqPageLd = (items: readonly { question: string; answer: string }[]) => [
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.question, acceptedAnswer: { "@type": "Answer", text: i.answer } })),
  },
];


/** `<` is escaped so a string value can never close the script element. */
export const serialiseLd = (doc: object): string => JSON.stringify(doc).replace(/</g, "\\u003c");

/** JSON-LD documents for a route's path; empty for most. Timeless FAQ answers only (see faq-data.ts). */
export const ldFor = (path: string): object[] => (path === "/" ? homeLd() : path === "/faq" ? faqPageLd(faqLdItems()) : []);

/** The head the prerenderer writes: the client-safe model plus this route's JSON-LD. */
export const serverHeadModel = (route: RouteMeta): HeadModel => headModel(route, ldFor(route.path).map(serialiseLd));
