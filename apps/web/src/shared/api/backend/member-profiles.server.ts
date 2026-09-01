import "server-only";

import { MemberProfilesService } from "./generated/platform-api";
import {
  executeGeneratedRequest,
  type BackendTransportResult,
} from "./transport-core.server";

export function requestPrivateMemberProfile(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MemberProfilesService(request).readPrivateAccountProfile(),
    200,
    { accessToken },
  );
}

export function requestMemberProfileCreation(
  input: { readonly bio: string | null; readonly displayName: string },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MemberProfilesService(request).createMemberProfile({ requestBody: input }),
    201,
    { accessToken },
  );
}

export function requestMemberProfileUpdate(
  input: { readonly bio: string | null; readonly displayName: string; readonly expectedVersion: number },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MemberProfilesService(request).updateMemberProfile({ requestBody: input }),
    200,
    { accessToken },
  );
}

export function requestMemberProfileProjection(
  publicProfileId: string,
  accessToken?: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MemberProfilesService(request).viewMemberProfile({ publicProfileId }),
    200,
    accessToken === undefined ? {} : { accessToken },
  );
}
