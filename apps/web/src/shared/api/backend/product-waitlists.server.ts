import "server-only";
import { ProductWaitlistsService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";
export function requestProductWaitlistIntake(productId: string) {
  return executeGeneratedRequest(
    (request) =>
      new ProductWaitlistsService(request).readProductWaitlistIntake({
        productId,
      }),
    200,
  );
}
export function requestProductWaitlistMembership(
  productId: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new ProductWaitlistsService(request).readProductWaitlistMembership({
        productId,
      }),
    200,
    { accessToken },
  );
}
export function requestJoinProductWaitlist(
  input: {
    readonly intakeId: string;
    readonly operationId: string;
    readonly source: string | null;
  },
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new ProductWaitlistsService(request).joinProductWaitlist({
        requestBody: input,
      }),
    200,
    { accessToken },
  );
}
export function requestWithdrawProductWaitlist(
  intakeId: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new ProductWaitlistsService(request).withdrawProductWaitlist({
        requestBody: { intakeId },
      }),
    200,
    { accessToken },
  );
}
