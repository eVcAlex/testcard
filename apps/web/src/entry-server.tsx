import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "preact-render-to-string";
import { headToHtml } from "./head.ts";
import { ROUTES, buildSitemap, metaFor } from "./routes-meta.ts";
import { serverHeadModel } from "./routes-ld.ts";
import { createAppRouter } from "./router.tsx";

interface Rendered { html: string; head: string; status: 200 | 404 }

/** Render one URL to the app markup and its head tags. Unknown paths come back as the 404 page. */
export async function render(url: string): Promise<Rendered> {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [url] }), isServer: true });
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);
  const route = metaFor(new URL(url, "http://localhost").pathname);
  return { html, head: headToHtml(serverHeadModel(route)), status: ROUTES.includes(route) ? 200 : 404 };
}

export { ROUTES, buildSitemap };
