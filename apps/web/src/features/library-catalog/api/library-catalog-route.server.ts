import "server-only";

import {
  getLibraryCatalogPage,
  getTopicMaterialCatalogPage,
  LibraryQueryRejectedError,
} from "./get-library-catalog";
import { parseLibrarySearchParams } from "@/features/library-catalog";
import { backendProxyProblem } from "@/shared/api/backend/index.server";

const PUBLIC_CATALOG_HEADERS = {
  "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
} as const;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

/** Feature-owned BFF adapter for the browser-owned catalog. */
export async function handleLibraryCatalogRequest(
  request: Request,
  accessToken?: string,
): Promise<Response> {
  return handleCatalogRequest(request, accessToken);
}

export async function handleTopicMaterialCatalogRequest(
  request: Request,
  topicSlug: string,
  accessToken?: string,
): Promise<Response> {
  return handleCatalogRequest(request, accessToken, topicSlug);
}

async function handleCatalogRequest(
  request: Request,
  accessToken?: string,
  canonicalTopicSlug?: string,
  feedOnly = false,
): Promise<Response> {
  const parsed = parseLibrarySearchParams(new URL(request.url).searchParams, {
    includeCursor: true,
  });
  if (parsed.wasNormalized) {
    return invalidLibraryQueryResponse();
  }

  let page: Awaited<ReturnType<typeof getLibraryCatalogPage>>;
  try {
    page =
      canonicalTopicSlug === undefined
        ? await getLibraryCatalogPage(
            parsed.query,
            parsed.query.after ?? undefined,
            accessToken,
            undefined,
            feedOnly,
          )
        : await getTopicMaterialCatalogPage(
            canonicalTopicSlug,
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
    return backendProxyProblem(
      503,
      "library_unavailable",
      "Library unavailable",
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
  return backendProxyProblem(
    400,
    "invalid_library_query",
    "Invalid Library query",
  );
}

export async function handleHomeFeedRequest(
  request: Request,
  accessToken?: string,
): Promise<Response> {
  return handleCatalogRequest(request, accessToken, undefined, true);
}
