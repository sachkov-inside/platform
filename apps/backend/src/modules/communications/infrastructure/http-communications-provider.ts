import type { PlatformConfig } from "../../../config/platform-config.js";
import { responseSchema } from "../communications-schema.generated.js";
import { communicationsFailure, type CommunicationsResult, type ProviderRequest, type ProviderResponse } from "../communications-contract.js";

const PROVIDER_REQUEST_TIMEOUT_MS = 5_000;
// Telegram embeds bot credentials in API/download paths; a plain mention of the
// API domain remains valid author content.
const TELEGRAM_CREDENTIAL_URL = /\bapi\.telegram\.org\.?(?::[0-9]+)?\/(?:file\/)?bot[^/\s]+/iu;
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
        TELEGRAM_CREDENTIAL_URL.test(JSON.stringify(value))) return communicationsFailure("provider_invalid_response");
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
      return "template" in value && sameId(value.template.templateId, request.payload.templateId);
    case "templates.testSend": return "testDeliveryId" in value;
    case "funnels.read": case "funnels.save": case "funnels.publish": case "funnels.lifecycle": case "funnels.rollback":
      return "funnel" in value && sameId(value.funnel.funnelId, request.payload.funnelId);
    case "funnels.preview": return "preview" in value && sameId(value.preview.funnelId, request.payload.funnelId);
    case "funnels.list": return "funnels" in value;
    case "broadcasts.read": case "broadcasts.save": case "broadcasts.launch": case "broadcasts.lifecycle":
      return "broadcast" in value && sameId(value.broadcast.broadcastId, request.payload.broadcastId);
    case "intro.read": return "intro" in value;
    case "intro.save": return "intro" in value && sameId(value.intro.introId, request.payload.introId);
    case "statistics.read": return "statistics" in value;
    case "deliveries.read": return "deliveries" in value;
    case "delivery.resolve": return "deliveryId" in value && sameId(value.deliveryId, request.payload.deliveryId) && sameId(value.partId, request.payload.partId) && value.outcome === (request.payload.action === "skip" ? "skipped" : "retry_requested");
    case "broadcasts.list": return "broadcasts" in value;
    case "entries.read": return "entries" in value;
    case "tracking.resolve": return "safeUrl" in value;
    case "tracking.recordHit": return "eventId" in value && sameId(value.eventId, request.payload.eventId);
    case "eligibility.check": return false;
  }
}

function sameId(left: string, right: string): boolean {
  // UUID wire spelling may differ from PostgreSQL's canonical lowercase output.
  return left.toLowerCase() === right.toLowerCase();
}
