import "server-only";

import {
  getLibraryCatalogPage,
  LibraryQueryRejectedError,
} from "./get-library-catalog";
import { parseLibrarySearchParams } from "../model/library-search-query";

const PUBLIC_CATALOG_HEADERS = {
  "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
} as const;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

/** Feature-owned BFF adapter for browser continuations of the public catalog. */
export async function handleLibraryCatalogRequest(
  request: Request,
  accessToken?: string,
): Promise<Response> {
  const parsed = parseLibrarySearchParams(new URL(request.url).searchParams);
  if (parsed.wasNormalized) {
    return invalidLibraryQueryResponse();
  }

  let page: Awaited<ReturnType<typeof getLibraryCatalogPage>>;
  try {
    page = await getLibraryCatalogPage(
      parsed.query,
      parsed.query.after ?? undefined,
      accessToken,
    );
  } catch (error) {
    if (error instanceof LibraryQueryRejectedError) {
      return invalidLibraryQueryResponse();
    }
    throw error;
  }
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

  return Response.json(page, {
    headers:
      accessToken === undefined
        ? PUBLIC_CATALOG_HEADERS
        : PRIVATE_NO_STORE_HEADERS,
  });
}

function invalidLibraryQueryResponse(): Response {
  return Response.json(
    {
      type: "urn:inside:web-problem:invalid-library-query",
      title: "Invalid Library query",
      status: 400,
    },
    { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
  );
}
