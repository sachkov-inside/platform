import "server-only";
import { z } from "zod";

import {
  requestAcknowledgeCourseAssistantDataNotice,
  requestBeginCourseAssistantRepositoryConnection,
  requestCompleteCourseAssistantRepositoryConnection,
  requestCourseAssistantParticipant,
  requestCourseAssistantRepositories,
  requestDisconnectCourseAssistantRepository,
  requestLinkCourseAssistantRepository,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  handleAuthenticatedMutation,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import {
  courseAssistantFailureCodeSchema,
  courseAssistantParticipantSchema,
  linkableRepositorySchema,
  repositoryLinkSchema,
  type CourseAssistantFailureCode,
  type CourseAssistantParticipant,
  type RepositoryConnectionOutcome,
} from "../model/course-assistant";

const privateHeaders = { "cache-control": "private, no-store" };
const positiveId = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

function failure(result: Extract<BackendTransportResult, { ok: false }>): {
  readonly ok: false;
  readonly code: CourseAssistantFailureCode;
} {
  if (result.response.status === 401)
    return { ok: false, code: "unauthorized" };
  const problem = z
    .object({ code: courseAssistantFailureCodeSchema })
    .safeParse(result.problem);
  return {
    ok: false,
    code: problem.success ? problem.data.code : "unavailable",
  };
}

export type CourseAssistantParticipantLoad =
  | { readonly kind: "ready"; readonly participant: CourseAssistantParticipant }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" };

/** Состояние помощника для серверной отрисовки страницы; закрытый помощник — `unavailable`. */
export async function loadCourseAssistantParticipant(
  accessToken: string,
): Promise<CourseAssistantParticipantLoad> {
  try {
    const result = await requestCourseAssistantParticipant(accessToken);
    if (!result.ok)
      return result.response.status === 404
        ? { kind: "unavailable" }
        : { kind: "failed" };
    const parsed = courseAssistantParticipantSchema.safeParse(result.body);
    return parsed.success
      ? { kind: "ready", participant: parsed.data }
      : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

export function handleAcknowledgeCourseAssistantDataNotice(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const version = z.string().min(1).max(64).safeParse(form.get("version"));
    if (!version.success) return { ok: false, code: "invalid_request" };
    try {
      const result = await requestAcknowledgeCourseAssistantDataNotice(
        version.data,
        token,
      );
      return result.ok ? { ok: true } : failure(result);
    } catch {
      return { ok: false, code: "unavailable" };
    }
  });
}

export function handleBeginCourseAssistantRepositoryConnection(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, async (_form, token) => {
    try {
      const result =
        await requestBeginCourseAssistantRepositoryConnection(token);
      if (!result.ok) return failure(result);
      const body = z.object({ installUrl: z.url() }).safeParse(result.body);
      return body.success
        ? { ok: true, installUrl: body.data.installUrl }
        : { ok: false, code: "unavailable" };
    } catch {
      return { ok: false, code: "unavailable" };
    }
  });
}

export function handleLinkCourseAssistantRepository(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const installationId = positiveId.safeParse(form.get("installationId"));
    const repositoryId = positiveId.safeParse(form.get("repositoryId"));
    if (!installationId.success || !repositoryId.success)
      return { ok: false, code: "invalid_request" };
    try {
      const result = await requestLinkCourseAssistantRepository(
        {
          installationId: installationId.data,
          repositoryId: repositoryId.data,
        },
        token,
      );
      return result.ok ? { ok: true } : failure(result);
    } catch {
      return { ok: false, code: "unavailable" };
    }
  });
}

export function handleDisconnectCourseAssistantRepository(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, async (_form, token) => {
    try {
      const result = await requestDisconnectCourseAssistantRepository(token);
      return result.ok ? { ok: true } : failure(result);
    } catch {
      return { ok: false, code: "unavailable" };
    }
  });
}

export async function handleReadCourseAssistantRepositories(): Promise<Response> {
  try {
    const token = await getPlatformAccessToken(readLogtoBffConfig());
    const result = await requestCourseAssistantRepositories(token);
    if (!result.ok)
      return Response.json(failure(result), {
        headers: privateHeaders,
        status: result.response.status,
      });
    const parsed = z
      .object({ repositories: z.array(linkableRepositorySchema) })
      .safeParse(result.body);
    return parsed.success
      ? Response.json(
          { ok: true, repositories: parsed.data.repositories },
          { headers: privateHeaders },
        )
      : new Response(null, { headers: privateHeaders, status: 502 });
  } catch (error) {
    return new Response(null, {
      headers: privateHeaders,
      status: error instanceof LogtoSessionUnavailableError ? 401 : 503,
    });
  }
}

const callbackSchema = z.object({
  code: z.string().min(1).max(200),
  installation_id: positiveId,
  state: z.string().min(1).max(100),
});

/**
 * Адрес возврата GitHub App. GitHub приводит участника сюда с кодом авторизации, номером
 * установки и тем же `state`; backend проверяет всё это сам. Ответ — перенаправление на страницу
 * помощника с исходом, а не страница: код авторизации не должен остаться в адресной строке.
 */
export async function handleCourseAssistantGitHubCallback(
  request: Request,
): Promise<Response> {
  const config = readLogtoBffConfig();
  const params = new URL(request.url).searchParams;
  const redirect = (outcome: RepositoryConnectionOutcome) =>
    new Response(null, {
      headers: {
        ...privateHeaders,
        location: new URL(
          `/account/course-assistant?connection=${outcome}`,
          config.baseUrl,
        ).toString(),
      },
      status: 303,
    });
  if (params.get("setup_action") === "request")
    return redirect("request_pending");
  const callback = callbackSchema.safeParse({
    code: params.get("code"),
    installation_id: params.get("installation_id"),
    state: params.get("state"),
  });
  if (!callback.success) return redirect("invalid_connection");
  let token: string;
  try {
    token = await getPlatformAccessToken(config);
  } catch (error) {
    return redirect(
      error instanceof LogtoSessionUnavailableError
        ? "session_expired"
        : "unavailable",
    );
  }
  try {
    const result = await requestCompleteCourseAssistantRepositoryConnection(
      {
        state: callback.data.state,
        code: callback.data.code,
        installationId: callback.data.installation_id,
      },
      token,
    );
    if (!result.ok) {
      const { code } = failure(result);
      return redirect(
        code === "installation_not_owned" ||
          code === "write_access_requested" ||
          code === "invalid_connection"
          ? code
          : code === "unauthorized"
            ? "session_expired"
            : "unavailable",
      );
    }
    const outcome = z
      .object({ repositoryLink: repositoryLinkSchema.nullable() })
      .safeParse(result.body);
    if (!outcome.success) return redirect("unavailable");
    return redirect(
      outcome.data.repositoryLink === null ? "choose_repository" : "connected",
    );
  } catch {
    return redirect("unavailable");
  }
}
