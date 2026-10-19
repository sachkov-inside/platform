import "server-only";

import {
  ProductTaskAuthoringService,
  ProductTasksService,
} from "./generated/platform-api";
import {
  executeGeneratedRequest,
  readBackendBaseUrl,
  type BackendTransportResult,
} from "./transport-core.server";

/** The task page: full requirements when open, its place when closed; a token adds personal access. */
export function requestProductTaskPage(
  productSlug: string,
  code: string,
  options: { readonly accessToken?: string } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ProductTasksService(request).readProductTaskPage({
        slug: productSlug,
        code,
      }),
    200,
    options,
  );
}

/** Optional, independently authorized practice attached to one Material. */
export function requestMaterialTaskPage(
  materialId: string,
  options: { readonly accessToken?: string } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ProductTasksService(request).readMaterialTaskPage({ materialId }),
    200,
    options,
  );
}

/** The current Account's submissions of one task with their version criteria and author feedback. */
export function requestOwnTaskSubmissions(
  code: string,
  accessToken: string,
  after?: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ProductTasksService(request).listOwnTaskSubmissions({
        code,
        ...(after === undefined ? {} : { after }),
      }),
    200,
    { accessToken },
  );
}

/** One submission through the task page form (#947). */
export function requestSubmitProductTaskForm(
  code: string,
  submission: {
    readonly taskVersion: number;
    readonly submissionKey: string;
    readonly note: string;
    readonly repositoryUrl?: string;
    readonly reportText?: string;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ProductTasksService(request).submitProductTaskForm({
        code,
        requestBody: {
          taskVersion: submission.taskVersion,
          submissionKey: submission.submissionKey,
          note: submission.note,
          ...(submission.repositoryUrl === undefined
            ? {}
            : { repositoryUrl: submission.repositoryUrl }),
          ...(submission.reportText === undefined
            ? {}
            : { reportText: submission.reportText }),
        },
      }),
    200,
    { accessToken },
  );
}

/** The author's «Сдачи» section: submissions by Product, chapter and task, newest first (#948). */
export function requestAuthorTaskSubmissions(
  query: {
    readonly productCursor?: string;
    readonly submissionId?: string;
    readonly productId?: string;
    readonly chapterId?: string;
    readonly taskCode?: string;
    readonly cursor?: string;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ProductTaskAuthoringService(request).listAuthorTaskSubmissions({
        ...(query.productCursor === undefined
          ? {}
          : { productCursor: query.productCursor }),
        ...(query.submissionId === undefined
          ? {}
          : { submissionId: query.submissionId }),
        ...(query.productId === undefined
          ? {}
          : { productId: query.productId }),
        ...(query.chapterId === undefined
          ? {}
          : { chapterId: query.chapterId }),
        ...(query.taskCode === undefined ? {} : { taskCode: query.taskCode }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      }),
    200,
    { accessToken },
  );
}

/** The author's comment and «посмотрел автор» on one submission (#948). */
export function requestSaveAuthorTaskFeedback(
  submissionId: string,
  feedback: { readonly comment: string; readonly reviewed: boolean },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ProductTaskAuthoringService(request).saveAuthorTaskFeedback({
        submissionId,
        requestBody: { comment: feedback.comment, reviewed: feedback.reviewed },
      }),
    200,
    { accessToken },
  );
}

/** Task assets use the same viewer identity as the Task page and keep the backend redirect. */
export function requestProductTaskAssetDelivery(input: {
  readonly productSlug: string;
  readonly code: string;
  readonly assetId: string;
  readonly variantWidth?: number;
  readonly accessToken?: string;
  readonly signal: AbortSignal;
}): Promise<Response> {
  const url = new URL(
    `${readBackendBaseUrl()}/library/products/${encodeURIComponent(input.productSlug)}/tasks/${encodeURIComponent(input.code)}/assets/${encodeURIComponent(input.assetId)}`,
  );
  if (input.variantWidth !== undefined)
    url.searchParams.set("width", String(input.variantWidth));
  return fetch(url, {
    cache: "no-store",
    redirect: "manual",
    headers:
      input.accessToken === undefined
        ? {}
        : { authorization: `Bearer ${input.accessToken}` },
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]),
  });
}
