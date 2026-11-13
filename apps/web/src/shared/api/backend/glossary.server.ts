import "server-only";

import {
  ContentLibraryService,
  GlossaryService,
} from "./generated/platform-api";
import {
  executeGeneratedRequest,
  type BackendTransportResult,
} from "./transport-core.server";

export function requestGlossaryTermMarks(
  termIds: readonly string[],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new GlossaryService(request).readGlossaryTermMarks({
        requestBody: { termIds: [...termIds] },
      }),
    200,
    { accessToken },
  );
}

export function requestSetGlossaryTermMark(
  input: { readonly termId: string; readonly mark: "known" | "review" },
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new GlossaryService(request).setGlossaryTermMark({
        termId: input.termId,
        requestBody: { mark: input.mark },
      }),
    200,
    { accessToken },
  );
}

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
