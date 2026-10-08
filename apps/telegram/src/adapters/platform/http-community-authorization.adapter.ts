import { readBoundedJson } from "./read-bounded-json.js";
import {
  communityErrorStatus,
  validDispatchResponse,
  type DispatchAuthorizationRequest,
  type DispatchAuthorizationResponse,
} from "../../modules/community/community-contract.js";
import type { CommunityDispatchAuthorization } from "../../modules/community/community-ports.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";

/**
 * Checks both the HTTP status and the body. A mismatch is an invalid provider
 * response, never a repeated effect.
 */
export class HttpCommunityAuthorization implements CommunityDispatchAuthorization {
  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async authorize(
    request: DispatchAuthorizationRequest,
  ): Promise<DispatchAuthorizationResponse | undefined> {
    try {
      const signal = AbortSignal.timeout(5000);
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          authorization: `Bearer ${this.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      });
      const value = await readBoundedJson(response, 16_384, signal);
      if (!validDispatchResponse(value)) return;
      const result = value;
      if (result.operationId !== request.operationId) return;
      if (result.operation === "dispatch.error") {
        return response.status === communityErrorStatus[result.error]
          ? result
          : undefined;
      }
      if (
        response.status !== 200 ||
        result.dispatchId !== request.dispatchId ||
        result.attemptId !== request.attemptId
      )
        return;
      return result;
    } catch (error) {
      reportFailure("platform.community-authorization", error);
      return;
    }
  }
}
