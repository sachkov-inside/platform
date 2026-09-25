import { legalEditions } from "@inside/legal";
import { legalDocumentKeys } from "@inside/legal/document";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { expect, it } from "vitest";

import { legalDocumentView } from "@/_pages/legal.server";

import { config, proxy } from "../../proxy";

const origin = "https://inside.example.test";

function proxyFor(path: string) {
  return proxy(new NextRequest(`${origin}${path}`));
}

/** Адрес, на который `proxy` переписал запрос; `null` — запрос прошёл без подмены. */
function rewrittenTo(response: Response): string | null {
  return response.headers.get("x-middleware-rewrite");
}

const publishedPaths = [
  ...legalDocumentKeys.map((key) => ({ path: `/legal/${key}`, slug: key, version: undefined })),
  ...legalEditions.map((edition) => ({
    path: `/legal/${edition.key}/v${String(edition.version)}`,
    slug: edition.key,
    version: `v${String(edition.version)}`,
  })),
];

it("опубликованный документ и каждая его редакция проходят к странице без подмены", () => {
  for (const { path, slug, version } of publishedPaths) {
    const response = proxyFor(path);

    expect(legalDocumentView(slug, version), path).not.toBeNull();
    expect(rewrittenTo(response), path).toBeNull();
    expect(response.headers.get("x-middleware-next"), path).toBe("1");
  }
});

it("неизвестный документ и неизвестная редакция уходят на «не найдено» до начала ответа", () => {
  for (const path of [
    "/legal/facts-and-applicability",
    "/legal/purchase/v2",
    "/legal/terms/v01",
    "/legal/Terms",
    "/legal/terms/v1/extra",
  ]) {
    const response = proxyFor(path);

    expect(rewrittenTo(response), path).toBe(`${origin}/_unrouted`);
  }
  expect(legalDocumentView("facts-and-applicability")).toBeNull();
  expect(legalDocumentView("purchase", "v2")).toBeNull();
});

it("раздел документов в matcher не захватывает список /legal и чужие адреса", () => {
  const nextConfig = {};

  expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: "/legal/terms" })).toBe(true);
  expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: "/legal/purchase/v2" })).toBe(true);
  expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: "/legal" })).toBe(false);
  expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: "/materials/unknown" })).toBe(false);
  expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: "/" })).toBe(false);
});
