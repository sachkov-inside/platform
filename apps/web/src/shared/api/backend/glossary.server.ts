import "server-only";

import { ContentLibraryService } from "./generated/platform-api";
import {
  executeGeneratedRequest,
  type BackendTransportResult,
} from "./transport-core.server";

/** «Словарь курса»: ответ зависит от читателя, поэтому вошедший передаёт свой токен. */
export function requestCourseGlossary(
  slug: string,
  options: { readonly accessToken?: string } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ContentLibraryService(request).readCourseGlossary({ slug }),
    200,
    options,
  );
}
