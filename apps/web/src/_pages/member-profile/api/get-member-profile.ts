import "server-only";

import {
  BackendConnectionError,
  requestMemberProfileProjection,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { MemberProfileProjectionData } from "@/entities/member-profile";
import { parseMemberProfileProblem } from "@/entities/member-profile";

import { parseMemberProfileProjection } from "./member-profile-contract";

export type MemberProfileProjectionResult =
  | { readonly kind: "ready"; readonly profile: MemberProfileProjectionData }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable"; readonly reference: string };

export async function getMemberProfile(
  publicProfileId: string,
  accessToken: string | undefined,
  request: typeof requestMemberProfileProjection = requestMemberProfileProjection,
): Promise<MemberProfileProjectionResult> {
  let result: BackendTransportResult;
  try {
    result = await request(publicProfileId, accessToken);
  } catch (error) {
    return unavailable(error);
  }
  if (!result.ok) {
    if ([401, 403, 404].includes(result.response.status)) {
      return { kind: "not_found" };
    }
    const problem = parseMemberProfileProblem(result.problem);
    return {
      kind: "unavailable",
      reference:
        problem?.correlationId ??
        problem?.code ??
        `profile-response-${String(result.response.status)}`,
    };
  }
  try {
    return { kind: "ready", profile: parseMemberProfileProjection(result.body) };
  } catch (error) {
    return unavailable(error);
  }
}

function unavailable(
  error: unknown,
): Extract<MemberProfileProjectionResult, { readonly kind: "unavailable" }> {
  return {
    kind: "unavailable",
    reference:
      error instanceof BackendConnectionError ? error.code : "profile-contract",
  };
}
