import { randomUUID } from "node:crypto";
import type {
  WaitlistAuthorization,
  WaitlistAuthorizationResult,
  WaitlistQuery,
} from "../../modules/communications/waitlist-authorization.js";
import {
  COMMUNICATIONS_VERSION,
  contractValidator,
} from "../../modules/communications/communications-contract.js";
import { readBoundedJson } from "./read-bounded-json.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";
const validResponse = contractValidator<
  Extract<WaitlistAuthorizationResult, { status: "ok" }> & { requestId: string }
>("waitlistAudienceResponse");
// The complete audience is bounded by the shared schema, including 10,000 opaque binding pairs.
const MAX_AUDIENCE_RESPONSE_BYTES = 8_000_000;
export class HttpWaitlistAuthorizationAdapter implements WaitlistAuthorization {
  private readonly endpoint: string;
  constructor(
    authorizationEndpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.endpoint = new URL("waitlist", authorizationEndpoint).href;
  }
  async read(query: WaitlistQuery): Promise<WaitlistAuthorizationResult> {
    const requestId = randomUUID();
    const signal = AbortSignal.timeout(5000);
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          authorization: `Bearer ${this.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contractVersion: COMMUNICATIONS_VERSION,
          requestId,
          ...query,
        }),
      });
      if (response.status === 401 || response.status === 403)
        return { status: "denied" };
      if (!response.ok) return { status: "unavailable" };
      const body = await readBoundedJson(
        response,
        MAX_AUDIENCE_RESPONSE_BYTES,
        signal,
      );
      if (!validResponse(body) || body.requestId !== requestId)
        return { status: "unavailable" };
      return {
        status: "ok",
        saleOpen: body.saleOpen,
        purchaseUrl: body.purchaseUrl,
        active: body.active,
        members: body.members,
      };
    } catch (error) {
      reportFailure("platform.waitlist-authorization", error);
      return { status: "unavailable" };
    }
  }
}
