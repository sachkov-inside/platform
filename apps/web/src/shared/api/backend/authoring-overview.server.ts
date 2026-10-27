import "server-only";

import { AuthoringOverviewService } from "./generated/platform-api";
import {
  executeGeneratedRequest,
  type BackendTransportResult,
} from "./transport-core.server";

/** Days of an Overview period; the generated client declares the same three choices. */
export type AuthoringOverviewPeriod = 7 | 30 | 90;

/**
 * The admin Overview (#1719); each block answers by the caller's rights. 403 when the Account has
 * neither `billing:manage` nor `materials:manage`.
 */
export function requestAuthoringOverview(
  period: AuthoringOverviewPeriod,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new AuthoringOverviewService(request).readAuthoringOverview({ period }),
    200,
    { accessToken },
  );
}

/** The Overview of one Product; `billing:manage` only, 404 for an unknown Product. */
export function requestProductOverview(
  productId: string,
  period: AuthoringOverviewPeriod,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new AuthoringOverviewService(request).readProductOverview({
        productId,
        period,
      }),
    200,
    { accessToken },
  );
}
