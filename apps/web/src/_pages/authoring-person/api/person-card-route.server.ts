import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestPersonCard,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import { personCardSchema, type PersonCardState } from "../model/person-card";

const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export interface PersonCardDependencies {
  readonly read: typeof requestPersonCard;
}

const productionDependencies: PersonCardDependencies = {
  read: requestPersonCard,
};

/** `GET /api/authoring/people/[accountId]`: карточка человека для браузера. */
export function handlePersonCardRequest(
  accountId: string,
  dependencies: PersonCardDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const id = z.uuid().safeParse(accountId);
    const state: PersonCardState = id.success
      ? await readPersonCard(id.data, accessToken, dependencies)
      : { kind: "not_found" };
    const status =
      state.kind === "ready"
        ? 200
        : state.kind === "not_found"
          ? 404
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

export async function readPersonCard(
  accountId: string,
  accessToken: string,
  dependencies: PersonCardDependencies = productionDependencies,
): Promise<PersonCardState> {
  let result: BackendTransportResult;
  try {
    result = await dependencies.read(accountId, accessToken);
  } catch (error) {
    if (error instanceof BackendConnectionError)
      return { kind: "unavailable", reference: error.code };
    throw error;
  }
  if (!result.ok) {
    if (result.response.status === 401) return { kind: "signed_out" };
    if (result.response.status === 403) return { kind: "forbidden" };
    if (result.response.status === 404) return { kind: "not_found" };
    const problem = problemSchema.safeParse(result.problem);
    return {
      kind: "unavailable",
      reference: problem.success
        ? (problem.data.correlationId ?? problem.data.code)
        : "person-card",
    };
  }
  const parsed = personCardSchema.safeParse(result.body);
  return parsed.success
    ? { kind: "ready", card: parsed.data }
    : { kind: "unavailable", reference: "malformed-response" };
}
