import "server-only";

import { getLibraryCatalogPage } from "./get-library-catalog";

const PUBLIC_CATALOG_HEADERS = {
  "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
} as const;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

/** Feature-owned BFF adapter for browser continuations of the public catalog. */
export async function handleLibraryCatalogRequest(
  request: Request,
): Promise<Response> {
  const afterValues = new URL(request.url).searchParams.getAll("after");
  if (
    afterValues.length > 1 ||
    (afterValues[0] !== undefined &&
      (afterValues[0].length === 0 || afterValues[0].length > 512))
  ) {
    return Response.json(
      {
        type: "urn:inside:web-problem:invalid-library-query",
        title: "Invalid Library query",
        status: 400,
      },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const page = await getLibraryCatalogPage(afterValues[0]);
  if (page.kind === "unavailable") {
    return Response.json(
      {
        type: "urn:inside:web-problem:library-unavailable",
        title: "Library unavailable",
        status: 503,
      },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  return Response.json(page, { headers: PUBLIC_CATALOG_HEADERS });
}
