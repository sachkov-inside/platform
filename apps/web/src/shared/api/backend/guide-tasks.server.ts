import "server-only";

import { GuideTasksService } from "./generated/platform-api";
import {
  executeGeneratedRequest,
  type BackendTransportResult,
} from "./transport-core.server";

/** The task page: full requirements when open, its place when closed; a token adds personal access. */
export function requestGuideTaskPage(
  guideSlug: string,
  code: string,
  options: { readonly accessToken?: string } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new GuideTasksService(request).readGuideTaskPage({
        slug: guideSlug,
        code,
      }),
    200,
    options,
  );
}

/** The current Account's submissions of one task with their version criteria and author feedback. */
export function requestOwnTaskSubmissions(
  code: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new GuideTasksService(request).listOwnTaskSubmissions({ code }),
    200,
    { accessToken },
  );
}

/** One submission through the task page form (#947). */
export function requestSubmitGuideTaskForm(
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
      new GuideTasksService(request).submitGuideTaskForm({
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
