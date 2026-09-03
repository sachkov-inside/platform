import "server-only";

import { TelegramMembershipService } from "./generated/platform-api";
import {
  executeGeneratedRequest,
  type BackendTransportResult,
} from "./transport-core.server";

export function requestCurrentAccountTelegramMembership(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new TelegramMembershipService(
        request,
      ).readCurrentAccountTelegramMembership(),
    200,
    { accessToken },
  );
}

export function requestTelegramMembershipLinkBegin(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new TelegramMembershipService(request).beginTelegramMembershipLink(),
    200,
    { accessToken },
  );
}

export function requestTelegramMembershipLinkConfirmation(
  linkRef: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new TelegramMembershipService(request).confirmTelegramMembershipLink({
        linkRef,
      }),
    200,
    { accessToken },
  );
}
