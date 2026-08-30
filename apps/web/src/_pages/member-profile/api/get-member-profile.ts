import "server-only";

import {
  requestMemberProfileProjection,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { MemberProfileProjection } from "@/_pages/account/model/member-profile";
import { parseMemberProfileProjection } from "@/_pages/account/api/member-profile-contract";

export type MemberProfileProjectionResult =
  | { readonly kind: "ready"; readonly profile: MemberProfileProjection }
  | { readonly kind: "not_found" };

export async function getMemberProfile(
  publicProfileId: string,
  accessToken: string | undefined,
  request: typeof requestMemberProfileProjection = requestMemberProfileProjection,
): Promise<MemberProfileProjectionResult> {
  let result: BackendTransportResult;
  try {
    result = await request(publicProfileId, accessToken);
  } catch {
    return { kind: "not_found" };
  }
  if (!result.ok) return { kind: "not_found" };
  try {
    return { kind: "ready", profile: parseMemberProfileProjection(result.body) };
  } catch {
    return { kind: "not_found" };
  }
}
