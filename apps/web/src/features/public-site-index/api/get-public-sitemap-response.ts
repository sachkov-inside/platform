import "server-only";
import { z } from "zod";
import { getPublicSitemapChunks } from "./get-public-sitemap-chunks";

const chunkIdSchema = z.string().regex(/^(0|[1-9][0-9]*)\.xml$/u);

export async function getPublicSitemapResponse(id: unknown): Promise<Response> {
  const parsed = chunkIdSchema.safeParse(id);
  if (!parsed.success) return new Response(null, { status: 404 });
  const index = Number(parsed.data.slice(0, -4));
  if (!Number.isSafeInteger(index)) return new Response(null, { status: 404 });
  const chunks = await getPublicSitemapChunks();
  const entries = chunks[index];
  if (entries === undefined) return new Response(null, { status: 404 });
  const urls = entries
    .map((entry) => {
      const lastModified = entry.lastModified;
      const lastmod =
        lastModified === undefined
          ? ""
          : `<lastmod>${escapeXml(lastModified instanceof Date ? lastModified.toISOString() : lastModified)}</lastmod>`;
      return `<url><loc>${escapeXml(entry.url)}</loc>${lastmod}</url>`;
    })
    .join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { "content-type": "application/xml" } },
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
