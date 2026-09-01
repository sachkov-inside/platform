import "server-only";

import { MemberProfilesService } from "./generated/platform-api";
import {
  executeGeneratedRequest,
  readBackendBaseUrl,
  type BackendTransportResult,
} from "./transport-core.server";

const PROFILE_AVATAR_MUTATION_TIMEOUT_MS = 60_000;
const PROFILE_AVATAR_DELIVERY_TIMEOUT_MS = 10_000;

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

export function requestProfileAvatarMutation(input: {
  readonly accessToken: string;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly contentType: string;
  readonly method: "DELETE" | "PUT";
  readonly signal: AbortSignal;
}): Promise<Response> {
  const init: RequestInit & { duplex: "half" } = {
    body: input.body,
    cache: "no-store",
    duplex: "half",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": input.contentType,
    },
    method: input.method,
    signal: AbortSignal.any([
      input.signal,
      AbortSignal.timeout(PROFILE_AVATAR_MUTATION_TIMEOUT_MS),
    ]),
  };
  return fetch(`${readBackendBaseUrl()}/account/profile/avatar`, init);
}

export function requestProfileAvatarDelivery(input: {
  readonly accessToken?: string;
  readonly avatarId: string;
  readonly publicProfileId: string;
  readonly signal: AbortSignal;
  readonly size: string;
}): Promise<Response> {
  const path = `/member-profiles/${encodeURIComponent(input.publicProfileId)}/avatar/${encodeURIComponent(input.avatarId)}/${encodeURIComponent(input.size)}`;
  return fetch(`${readBackendBaseUrl()}${path}`, {
    cache: "no-store",
    headers:
      input.accessToken === undefined
        ? {}
        : { authorization: `Bearer ${input.accessToken}` },
    redirect: "manual",
    signal: AbortSignal.any([
      input.signal,
      AbortSignal.timeout(PROFILE_AVATAR_DELIVERY_TIMEOUT_MS),
    ]),
  });
}
