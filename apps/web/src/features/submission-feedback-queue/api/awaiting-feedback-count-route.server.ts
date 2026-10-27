import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestSubmissionsAwaitingFeedbackCount,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import type { AwaitingFeedbackCountState } from "../model/awaiting-feedback-count";

const responseSchema = z
  .object({ count: z.number().int().nonnegative() })
  .strict();
const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export interface AwaitingFeedbackCountDependencies {
  readonly count: typeof requestSubmissionsAwaitingFeedbackCount;
}

const productionDependencies: AwaitingFeedbackCountDependencies = {
  count: requestSubmissionsAwaitingFeedbackCount,
};

/** `GET /api/authoring/product-tasks/awaiting-feedback-count`: счётчик для каркаса админки. */
export function handleAwaitingFeedbackCountRequest(
  dependencies: AwaitingFeedbackCountDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const state = await readAwaitingFeedbackCount(accessToken, dependencies);
    const status =
      state.kind === "ready"
        ? 200
        : state.kind === "signed_out"
          ? 401
          : state.kind === "forbidden"
            ? 403
            : 503;
    return Response.json(state, {
      status,
      ...(state.kind === "unavailable"
        ? { headers: { "x-correlation-id": state.reference } }
        : {}),
    });
  });
}

export async function readAwaitingFeedbackCount(
  accessToken: string,
  dependencies: AwaitingFeedbackCountDependencies = productionDependencies,
): Promise<AwaitingFeedbackCountState> {
  let result: BackendTransportResult;
  try {
    result = await dependencies.count(accessToken);
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
        : "counter",
    };
  }
  const parsed = responseSchema.safeParse(result.body);
  return parsed.success
    ? { kind: "ready", count: parsed.data.count }
    : { kind: "unavailable", reference: "malformed-response" };
}
