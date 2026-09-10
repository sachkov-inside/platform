import "server-only";

import { BookmarksService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

export function requestBookmarks(
  input: { readonly after?: string; readonly first?: number },
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new BookmarksService(request).listBookmarks({
        requestBody: {
          first: input.first ?? 12,
          ...(input.after === undefined ? {} : { after: input.after }),
        },
      }),
    200,
    { accessToken },
  );
}

export function requestBookmarkStates(
  materialIds: readonly string[],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new BookmarksService(request).getMaterialBookmarkStates({
        requestBody: { materialIds: [...materialIds] },
      }),
    200,
    { accessToken },
  );
}

export function requestAddBookmark(materialId: string, accessToken: string) {
  return executeGeneratedRequest(
    (request) => new BookmarksService(request).addMaterialBookmark({ materialId }),
    200,
    { accessToken },
  );
}

export function requestRemoveBookmark(materialId: string, accessToken: string) {
  return executeGeneratedRequest(
    (request) =>
      new BookmarksService(request).removeMaterialBookmark({ materialId }),
    200,
    { accessToken },
  );
}
