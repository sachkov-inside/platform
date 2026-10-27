import "server-only";

import { z } from "zod";

import {
  parseOverviewPeriod,
  type OverviewPeriodDays,
} from "@/features/admin-overview";
import {
  BackendConnectionError,
  requestAuthoringOverview,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import {
  overviewReportSchema,
  type OverviewState,
} from "../model/overview-report";

const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export interface OverviewDependencies {
  readonly read: typeof requestAuthoringOverview;
}

const productionDependencies: OverviewDependencies = {
  read: requestAuthoringOverview,
};

const statuses = {
  ready: 200,
  signed_out: 401,
  forbidden: 403,
  unavailable: 503,
} as const;

/** `GET /api/authoring/overview?period=7|30|90`: Обзор админки для браузера. */
export function handleOverviewRequest(
  request: Request,
  dependencies: OverviewDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const period = parseOverviewPeriod(
      new URL(request.url).searchParams.get("period"),
    );
    const state = await readOverview(period, accessToken, dependencies);
    return Response.json(state, {
      status: statuses[state.kind],
      ...(state.kind === "unavailable"
        ? { headers: { "x-correlation-id": state.reference } }
        : {}),
    });
  });
}

export async function readOverview(
  period: OverviewPeriodDays,
  accessToken: string,
  dependencies: OverviewDependencies = productionDependencies,
): Promise<OverviewState> {
  let result: BackendTransportResult;
  try {
    result = await dependencies.read(period, accessToken);
  } catch (error) {
    if (error instanceof BackendConnectionError)
      return { kind: "unavailable", reference: error.code };
    throw error;
  }
  if (!result.ok) {
    if (result.response.status === 401) return { kind: "signed_out" };
    if (result.response.status === 403) return { kind: "forbidden" };
    const problem = problemSchema.safeParse(result.problem);
    return {
      kind: "unavailable",
      reference: problem.success
        ? (problem.data.correlationId ?? problem.data.code)
        : "overview",
    };
  }
  const parsed = overviewReportSchema.safeParse(result.body);
  return parsed.success
    ? { kind: "ready", ...parsed.data }
    : { kind: "unavailable", reference: "malformed-response" };
}
