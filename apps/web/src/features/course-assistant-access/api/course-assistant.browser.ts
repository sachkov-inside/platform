import {
  requestSameOriginMutation,
  type SameOriginMutationResult,
} from "@/shared/api/same-origin-mutation";

import {
  courseAssistantWriteResultSchema,
  linkableRepositoriesResultSchema,
  repositoryConnectionResultSchema,
  type CourseAssistantWriteResult,
  type LinkableRepositoriesResult,
  type RepositoryConnectionResult,
} from "../model/course-assistant";

function failed(status: number) {
  return {
    ok: false,
    code: status === 401 ? "unauthorized" : "unavailable",
  } as const;
}

function decodeWrite(
  response: SameOriginMutationResult,
): CourseAssistantWriteResult {
  if (!response.ok) return failed(response.status);
  const parsed = courseAssistantWriteResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : failed(502);
}

export async function acknowledgeCourseAssistantDataNotice(
  version: string,
): Promise<CourseAssistantWriteResult> {
  const form = new FormData();
  form.set("version", version);
  return decodeWrite(
    await requestSameOriginMutation(
      "/api/account/course-assistant/acknowledgement",
      "POST",
      form,
    ),
  );
}

export async function beginCourseAssistantRepositoryConnection(): Promise<RepositoryConnectionResult> {
  const response = await requestSameOriginMutation(
    "/api/account/course-assistant/connection",
    "POST",
    new FormData(),
  );
  if (!response.ok) return failed(response.status);
  const parsed = repositoryConnectionResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : failed(502);
}

export async function linkCourseAssistantRepository(input: {
  readonly installationId: number;
  readonly repositoryId: number;
}): Promise<CourseAssistantWriteResult> {
  const form = new FormData();
  form.set("installationId", String(input.installationId));
  form.set("repositoryId", String(input.repositoryId));
  return decodeWrite(
    await requestSameOriginMutation(
      "/api/account/course-assistant/repository-link",
      "PUT",
      form,
    ),
  );
}

export async function disconnectCourseAssistantRepository(): Promise<CourseAssistantWriteResult> {
  return decodeWrite(
    await requestSameOriginMutation(
      "/api/account/course-assistant/repository-link",
      "DELETE",
      new FormData(),
    ),
  );
}

export async function readCourseAssistantRepositories(): Promise<LinkableRepositoriesResult> {
  let response: Response;
  try {
    response = await fetch("/api/account/course-assistant/repositories", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch {
    return failed(503);
  }
  if (response.status === 401) return failed(401);
  try {
    const parsed = linkableRepositoriesResultSchema.safeParse(
      await response.json(),
    );
    return parsed.success ? parsed.data : failed(502);
  } catch {
    return failed(502);
  }
}
