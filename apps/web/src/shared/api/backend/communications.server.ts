import "server-only";
import {
  CommunicationsService,
  CommunicationsTrackingService,
} from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";
const COMMUNICATIONS_ROUND_TRIP_TIMEOUT_MS = 12_000;
export type CommunicationsRequest = Parameters<
  CommunicationsService["manageCommunications"]
>[0]["requestBody"];
export function requestCommunications(
  input: CommunicationsRequest,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CommunicationsService(request).manageCommunications({
        requestBody: input,
      }),
    200,
    { accessToken, timeoutMs: COMMUNICATIONS_ROUND_TRIP_TIMEOUT_MS },
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
    { accessToken, timeoutMs: COMMUNICATIONS_ROUND_TRIP_TIMEOUT_MS },
  );
}
export function requestCommunicationVisit(input: {
  token: string;
  traffic: "unknown" | "known_automation";
}) {
  return executeGeneratedRequest(
    (request) =>
      new CommunicationsTrackingService(request).resolveCommunicationVisit({
        requestBody: input,
      }),
    200,
    { timeoutMs: COMMUNICATIONS_ROUND_TRIP_TIMEOUT_MS },
  );
}
