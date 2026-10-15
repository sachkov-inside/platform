import { connection } from "next/server";
import { getPublicSitemapChunks } from "@/features/public-site-index.server";
import {
  publicPageUrl,
  readPublicSiteOrigin,
} from "@/shared/link-preview/index.server";

export async function GET(): Promise<Response> {
  await connection();
  const origin = await readPublicSiteOrigin();
  const maps = (await getPublicSitemapChunks()).map((_, id) => ({ id }));
  const entries = maps
    .map(
      ({ id }) =>
        `<sitemap><loc>${publicPageUrl(origin, `/sitemaps/${String(id)}.xml`)}</loc></sitemap>`,
    )
    .join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`,
    { headers: { "content-type": "application/xml" } },
  );
}
