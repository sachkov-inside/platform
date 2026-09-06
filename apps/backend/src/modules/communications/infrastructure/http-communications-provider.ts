import type { PlatformConfig } from "../../../config/platform-config.js";
import { responseSchema } from "../communications-schema.generated.js";
import { communicationsFailure, type CommunicationsResult, type ProviderRequest, type ProviderResponse } from "../communications-contract.js";

const PROVIDER_REQUEST_TIMEOUT_MS = 5_000;
const errorStatuses = {
  unauthorized: 401, forbidden: 403, not_found: 404, malformed: 400,
  unsupported_content: 422, revision_conflict: 409, operation_conflict: 409,
  authorization_unavailable: 503, not_implemented: 501,
} as const;

export class HttpCommunicationsProvider {
  constructor(
    private readonly config: PlatformConfig["communications"],
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async execute(request: ProviderRequest): Promise<CommunicationsResult> {
    if (this.config === undefined) return communicationsFailure("provider_unavailable");
    try {
      const response = await this.fetcher(this.config.endpoint, {
        method: "POST", redirect: "error",
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
        headers: { authorization: `Bearer ${this.config.secret}`, "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json();
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) return communicationsFailure("provider_invalid_response");
      const value = parsed.data;
      if (value.status !== "ok") {
        return response.status === errorStatuses[value.status]
          ? communicationsFailure(value.status)
          : communicationsFailure("provider_invalid_response");
      }
      // The provider API host must never escape as a credential-bearing media URL.
      if (response.status !== 200 || !matchesOperation(request, value) ||
        ("template" in value && value.template.botIdentity !== this.config.botIdentity) ||
        JSON.stringify(value).toLowerCase().includes("api.telegram.org")) return communicationsFailure("provider_invalid_response");
      return { ok: true, value };
    } catch {
      // A timeout may follow a committed mutation. Never regenerate an operation
      // ID or retry an uncertain external effect here.
      return communicationsFailure("provider_unavailable");
    }
  }
}

function matchesOperation(request: ProviderRequest, value: Extract<ProviderResponse, { status: "ok" }>): boolean {
  switch (request.operation) {
    case "templates.read": case "templates.save":
      return "template" in value && value.template.templateId === request.payload.templateId;
    case "templates.testSend": return "testDeliveryId" in value;
    case "funnels.read": case "funnels.save": case "funnels.publish": case "funnels.lifecycle": case "funnels.rollback":
      return "funnel" in value && value.funnel.funnelId === request.payload.funnelId;
    case "funnels.preview": return "preview" in value && value.preview.funnelId === request.payload.funnelId;
    case "funnels.list": return "funnels" in value;
    case "broadcasts.read": case "broadcasts.save": case "broadcasts.launch": case "broadcasts.lifecycle":
      return "broadcast" in value && value.broadcast.broadcastId === request.payload.broadcastId;
    case "intro.read": return "intro" in value;
    case "intro.save": return "intro" in value && value.intro.introId === request.payload.introId;
    case "statistics.read": return "statistics" in value;
    case "deliveries.read": return "deliveries" in value;
    case "delivery.resolve": return "deliveryId" in value && value.deliveryId === request.payload.deliveryId && value.partId === request.payload.partId && value.outcome === (request.payload.action === "skip" ? "skipped" : "retry_requested");
    case "eligibility.check": case "tracking.resolve": case "tracking.recordHit": return false;
  }
}
