import { readBoundedJson } from "./read-bounded-json.js";
import {
  echoesRequest,
  validDispatchResponse,
  type DispatchRequest,
  type DispatchResponse,
} from "../../modules/notifications/notification-contract.js";
import type { NotificationAuthorization } from "../../modules/notifications/notification-ports.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";
export class HttpNotificationAuthorization implements NotificationAuthorization {
  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async authorize(
    request: DispatchRequest,
  ): Promise<DispatchResponse | undefined> {
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
      if (!echoesRequest(result, request)) return;
      const expected =
        result.status === "error"
          ? (
              {
                malformed: 400,
                unauthorized: 401,
                unsupported_contract: 422,
                operation_conflict: 409,
                unavailable: 503,
              } as Record<string, number>
            )[result.code]
          : 200;
      if (response.status !== expected) return;
      return result;
    } catch (error) {
      reportFailure("platform.notification-authorization", error);
      return;
    }
  }
}
