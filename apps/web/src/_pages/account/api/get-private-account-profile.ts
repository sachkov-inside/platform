import "server-only";

import {
  BackendConnectionError,
  requestPrivateAccountProfile,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { PrivateAccountProfileResult } from "@/entities/account-profile";
import { parseAccountProfileProblem } from "@/entities/account-profile";
import { parsePrivateProfileState } from "@/entities/account-profile";

export async function getPrivateAccountProfile(
  accessToken: string,
  request: typeof requestPrivateAccountProfile = requestPrivateAccountProfile,
): Promise<PrivateAccountProfileResult> {
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
  const problem = parseAccountProfileProblem(result.problem);
  return {
    kind: "unavailable",
    reference: problem?.correlationId ?? problem?.code ?? "profile-response",
  };
}

function unavailable(
  error: unknown,
): Extract<PrivateAccountProfileResult, { readonly kind: "unavailable" }> {
  return {
    kind: "unavailable",
    reference:
      error instanceof BackendConnectionError ? error.code : "profile-contract",
  };
}
