import { ORG_NAME, PRODUCT_FULL_NAME, PRODUCT_NAME, SITE_URL } from "./site.ts";

export interface RouteMeta {
  /** Canonical path, no trailing slash except "/". */
  path: string;
  title: string;
  description: string;
  /** Adds robots noindex, drops the canonical, and keeps the route out of the sitemap. */
  noindex?: boolean;
}

export const OG_IMAGE = { path: "/og.png", width: 1200, height: 630, alt: `${PRODUCT_FULL_NAME} by ${ORG_NAME}: a colour-bar strip and a ruled test-card circle.` } as const;

export const ROUTES: readonly RouteMeta[] = [
  {
    path: "/",
    title: `${PRODUCT_FULL_NAME} for Windows & Fire TV | by ${ORG_NAME}`,
    description: `${PRODUCT_NAME} is a free IPTV player for Windows and Fire TV with a real TV guide, tidy channel names and your own Xtream or M3U sources. Join the beta waitlist.`,
  },
  {
    path: "/download",
    title: `${PRODUCT_FULL_NAME}: beta for Windows & Fire TV`,
    description: `${PRODUCT_NAME} is in private beta. Join the waitlist for the free IPTV player for Windows and Fire TV, and see what it needs and how it installs.`,
  },
  {
    path: "/setup",
    title: `Add Xtream or M3U sources to ${PRODUCT_NAME}: setup guide`,
    description: `How to add an Xtream Codes login or an M3U playlist to ${PRODUCT_NAME}, load an XMLTV guide, refresh your sources and link your Fire TV.`,
  },
  {
    path: "/faq",
    title: `${PRODUCT_FULL_NAME} FAQ: EPG, sources, legality`,
    description: `Answers about ${PRODUCT_NAME}: where channels come from, adding Xtream and M3U sources, EPG and guide problems, whether an IPTV player is legal, and price.`,
  },
  {
    path: "/privacy",
    title: `Privacy | ${PRODUCT_NAME}`,
    description: `What ${PRODUCT_NAME} and this website store, what stays on your device, and how to ask for your data to be deleted.`,
  },
  {
    path: "/link",
    title: `Link your TV | ${PRODUCT_NAME}`,
    description: `Enter the code shown on your TV to sign in to ${PRODUCT_NAME}.`,
    noindex: true,
  },
];

export const NOT_FOUND_META: RouteMeta = {
  path: "/404",
  title: `No signal | ${PRODUCT_NAME}`,
  description: "That page isn't here. It may have moved, or the address is wrong.",
  noindex: true,
};

export const normalisePath = (pathname: string): string => (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname) || "/";

/** Meta for a pathname; anything unknown is the 404. */
export function metaFor(pathname: string): RouteMeta {
  const path = normalisePath(pathname);
  return ROUTES.find((r) => r.path === path) ?? NOT_FOUND_META;
}

export interface HeadTag { tag: "meta" | "link"; attrs: Record<string, string> }
export interface HeadModel { title: string; tags: HeadTag[]; jsonLd: string[] }

const meta = (key: "name" | "property", name: string, content: string): HeadTag => ({ tag: "meta", attrs: { [key]: name, content } });

/** Client-safe head: title and meta only. JSON-LD is prerender-only (routes-ld.ts) and passed in by the server. */
export function headModel(route: RouteMeta, jsonLd: string[] = []): HeadModel {
  const url = `${SITE_URL}${route.path === "/" ? "/" : route.path}`;
  const image = `${SITE_URL}${OG_IMAGE.path}`;
  const indexable = !route.noindex;
  const tags: HeadTag[] = [
    meta("name", "description", route.description),
    ...(route.noindex ? [meta("name", "robots", "noindex, nofollow")] : []),
    ...(indexable ? [{ tag: "link", attrs: { rel: "canonical", href: url } } satisfies HeadTag] : []),
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", PRODUCT_FULL_NAME),
    meta("property", "og:title", route.title),
    meta("property", "og:description", route.description),
    ...(indexable ? [meta("property", "og:url", url)] : []),
    meta("property", "og:image", image),
    meta("property", "og:image:width", String(OG_IMAGE.width)),
    meta("property", "og:image:height", String(OG_IMAGE.height)),
    meta("property", "og:image:alt", OG_IMAGE.alt),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", route.title),
    meta("name", "twitter:description", route.description),
    meta("name", "twitter:image", image),
  ];
  return { title: route.title, tags, jsonLd };
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const xml = (s: string) => s.replace(/[&<>"]/g, (c) => XML_ESCAPES[c] ?? c);

/** sitemap.xml for every indexable route. `lastmod` is YYYY-MM-DD. */
export function buildSitemap(lastmod: string, routes: readonly RouteMeta[] = ROUTES): string {
  const urls = routes
    .filter((r) => !r.noindex)
    .map((r) => `  <url><loc>${xml(SITE_URL + (r.path === "/" ? "/" : r.path))}</loc><lastmod>${lastmod}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
