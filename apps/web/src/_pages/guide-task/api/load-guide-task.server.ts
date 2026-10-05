import "server-only";

import {
  BackendConnectionError,
  requestGuideTaskPage,
  requestOwnTaskSubmissions,
} from "@/shared/api/backend/index.server";

import {
  guideTaskPageSchema,
  ownTaskSubmissionsSchema,
  type GuideTaskPageResult,
  type OwnSubmissionsView,
} from "../model/guide-task-page";

/**
 * The task page as the viewer sees it; never cached (ADR 0027): access, requirements and the
 * submission setting are personal or change without a new address. A malformed answer throws to
 * the route's error boundary.
 */
export async function getGuideTaskPage(
  guideSlug: string,
  code: string,
  accessToken?: string,
): Promise<GuideTaskPageResult> {
  try {
    const result = await requestGuideTaskPage(
      guideSlug,
      code,
      accessToken === undefined ? {} : { accessToken },
    );
    if (!result.ok) {
      const status = result.response.status;
      if (status === 404 || status === 400) return { kind: "not-found" };
      if (status === 503) return { kind: "unavailable" };
      throw new BackendConnectionError(
        "backend-error",
        `Guide Task page answered ${String(status)}`,
      );
    }
    const parsed = guideTaskPageSchema.safeParse(result.body);
    if (!parsed.success)
      throw new BackendConnectionError(
        "invalid-response",
        "Guide Task page does not match the contract",
        { cause: parsed.error },
      );
    return parsed.data.access === "open"
      ? { kind: "open", page: parsed.data }
      : { kind: "closed", task: parsed.data.task };
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable")
      return { kind: "unavailable" };
    throw error;
  }
}

/** The signed-in reader's own submissions; a failure here leaves the task readable. */
export async function loadOwnSubmissions(
  code: string,
  accessToken: string | undefined,
): Promise<OwnSubmissionsView> {
  if (accessToken === undefined) return { kind: "guest" };
  try {
    const result = await requestOwnTaskSubmissions(code, accessToken);
    if (!result.ok)
      return result.response.status === 401
        ? { kind: "guest" }
        : { kind: "unavailable" };
    const parsed = ownTaskSubmissionsSchema.safeParse(result.body);
    return parsed.success
      ? { kind: "ready", ...parsed.data }
      : { kind: "unavailable" };
  } catch (error) {
    if (error instanceof BackendConnectionError) return { kind: "unavailable" };
    throw error;
  }
}
