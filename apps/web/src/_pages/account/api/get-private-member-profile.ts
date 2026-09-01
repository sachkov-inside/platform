import "server-only";

import {
  BackendConnectionError,
  requestPrivateMemberProfile,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { PrivateMemberProfileResult } from "@/entities/member-profile";
import { parseMemberProfileProblem } from "@/entities/member-profile";
import {
  parsePrivateProfileState,
} from "./member-profile-contract";

export async function getPrivateMemberProfile(
  accessToken: string,
  request: typeof requestPrivateMemberProfile = requestPrivateMemberProfile,
): Promise<PrivateMemberProfileResult> {
  let result: BackendTransportResult;
  try {
    result = await request(accessToken);
  } catch (error) {
    return unavailable(error);
  }
  if (result.ok) {
    try {
      return { kind: "ready", state: parsePrivateProfileState(result.body) };
    } catch (error) {
      return unavailable(error);
    }
  }
  if (result.response.status === 401) return { kind: "unauthorized" };
  const problem = parseMemberProfileProblem(result.problem);
  return {
    kind: "unavailable",
    reference: problem?.correlationId ?? problem?.code ?? "profile-response",
  };
}

function unavailable(error: unknown): Extract<
  PrivateMemberProfileResult,
  { readonly kind: "unavailable" }
> {
  return {
    kind: "unavailable",
    reference:
      error instanceof BackendConnectionError ? error.code : "profile-contract",
  };
}
