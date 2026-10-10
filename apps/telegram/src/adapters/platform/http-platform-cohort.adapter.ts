import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import schema from "@inside/contracts/platform-billing-cohorts/schema.json" with { type: "json" };
import { hasText } from "../../shared/text.js";
import type {
  CommunityWelcomeDetails,
  CommunityWelcomeDetailsSource,
} from "../../modules/community/community-welcome.js";
import {
  reportCondition,
  reportFailure,
} from "../../shared/failure-diagnostics.js";

// The welcome waits for this read, and its personal link lives only minutes.
const READ_TIMEOUT_MILLISECONDS = 2_000;
const ajv = new Ajv({ strict: false });
addFormats.default(ajv);
// OpenAPI 3.0 uses boolean exclusiveMinimum; Ajv requires the numeric JSON Schema form.
const responseSchema: unknown = JSON.parse(
  JSON.stringify(schema.response),
  (_key, value: unknown) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("exclusiveMinimum" in value) ||
      value.exclusiveMinimum !== true ||
      !("minimum" in value)
    )
      return value;
    const { minimum, ...rest } = value;
    return { ...rest, exclusiveMinimum: minimum };
  },
);
if (typeof responseSchema !== "object" || responseSchema === null)
  throw new Error("Invalid cohort response schema");
const validResponse = ajv.compile(responseSchema);

/**
 * Public `GET /billing/cohorts` of Platform, described in `docs/contracts/platform-billing-cohorts`: the current stream of every product. The course
 * is found by its Platform product UUID, because the response carries no slug.
 */
export class HttpPlatformCohortAdapter implements CommunityWelcomeDetailsSource {
  private readonly productId: string;

  constructor(
    private readonly endpoint: string,
    productId: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.productId = productId.toLowerCase();
  }

  async read(): Promise<CommunityWelcomeDetails> {
    let body: unknown;
    try {
      const response = await this.fetcher(this.endpoint, {
        headers: {
          accept: "application/json",
          "x-inside-domain-names": "products.v1",
        },
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(READ_TIMEOUT_MILLISECONDS),
      });
      if (response.status !== 200) {
        reportCondition(
          "platform.cohort-read",
          `platform_http_${response.status}`,
        );
        return {};
      }
      body = await response.json();
    } catch (error) {
      reportFailure("platform.cohort-read", error);
      return {};
    }
    if (!validResponse(body)) {
      reportCondition("platform.cohort-read", "platform_response_invalid");
      return {};
    }
    const startsOn = this.startsOn(body);
    // A body outside the contract is noticed, not shown: the welcome still goes without a date.
    if (startsOn === undefined)
      reportCondition("platform.cohort-read", "platform_response_invalid");
    return hasText(startsOn) ? { streamStartsOn: startsOn } : {};
  }

  /** The course's start date, `null` without a stream or date, `undefined` for a foreign body. */
  private startsOn(body: unknown): string | null | undefined {
    if (typeof body !== "object" || body === null || !("items" in body))
      return undefined;
    const { items } = body;
    if (!Array.isArray(items)) return undefined;
    const cohort: unknown = items.find(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        "productId" in item &&
        typeof item.productId === "string" &&
        item.productId.toLowerCase() === this.productId,
    );
    if (cohort === undefined) return null;
    if (
      typeof cohort !== "object" ||
      cohort === null ||
      !("startsOn" in cohort)
    )
      return undefined;
    const { startsOn } = cohort;
    if (startsOn === null) return null;
    return typeof startsOn === "string" ? startsOn : undefined;
  }
}
