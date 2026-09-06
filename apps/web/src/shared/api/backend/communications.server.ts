import "server-only";
import { CommunicationsService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";
type ManagementRequest = Parameters<
  CommunicationsService["manageCommunications"]
>[0]["requestBody"];
export function requestCommunications(
  input: ManagementRequest,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CommunicationsService(request).manageCommunications({
        requestBody: input,
      }),
    200,
    { accessToken },
  );
}
export function requestCommunicationsTemplate(
  input: { reference: string; operationId: string },
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CommunicationsService(request).resolveCommunicationsTemplate({
        requestBody: input,
      }),
    200,
    { accessToken },
  );
}
