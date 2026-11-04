import { randomUUID } from "node:crypto";
import type {
  ProductAccess,
  ProductAccessResult,
} from "../../modules/communications/product-access.js";
import {
  COMMUNICATIONS_VERSION,
  contractValidator,
} from "../../modules/communications/communications-contract.js";
import { readBoundedJson } from "./read-bounded-json.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";

const validResponse = contractValidator<{
  readonly requestId: string;
  readonly withAccess: readonly string[];
}>("productAccessResponse");
// 100 identities of 256 characters, up to four UTF-8 bytes each, plus the envelope.
const MAX_RESPONSE_BYTES = 128_000;
const READ_TIMEOUT_MILLISECONDS = 5_000;
export class HttpProductAccessAdapter implements ProductAccess {
  private readonly endpoint: string;
  constructor(
    authorizationEndpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.endpoint = new URL("product-access", authorizationEndpoint).href;
  }
  async read(
    telegramIdentityRefs: readonly string[],
  ): Promise<ProductAccessResult> {
    const requestId = randomUUID();
    const signal = AbortSignal.timeout(READ_TIMEOUT_MILLISECONDS);
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
          telegramIdentityRefs,
        }),
      });
      if (!response.ok) return { status: "unavailable" };
      const body = await readBoundedJson(response, MAX_RESPONSE_BYTES, signal);
      if (!validResponse(body) || body.requestId !== requestId)
        return { status: "unavailable" };
      return { status: "ok", withAccess: body.withAccess };
    } catch (error) {
      reportFailure("platform.product-access", error);
      return { status: "unavailable" };
    }
  }
}
