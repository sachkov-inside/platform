import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { PRIVATE_NO_STORE_HEADERS } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  DISPATCH_CONTRACT_VERSION,
  dispatchErrorSchema,
  dispatchResultSchema,
  type CommunityErrorCode,
  type DispatchError,
} from "../../domain/community-entitlement.js";

export function communityDispatchError(
  operationId: string,
  error: CommunityErrorCode,
): DispatchError {
  return dispatchErrorSchema.parse({
    contractVersion: DISPATCH_CONTRACT_VERSION,
    error,
    operation: "dispatch.error",
    operationId,
  });
}

/** The service protocol requires correlated JSON errors, not the public RFC 9457 wrapper. */
@Catch(HttpException)
export class CommunityDispatchFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const body = exception.getResponse();
    const status = exception.getStatus();
    const correlated =
      dispatchErrorSchema.safeParse(body).success ||
      dispatchResultSchema.safeParse(body).success;
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(status)
      .headers(PRIVATE_NO_STORE_HEADERS)
      .type("application/json")
      .send(
        correlated
          ? body
          : { code: status === 401 ? "unauthorized" : "malformed" },
      );
  }
}
