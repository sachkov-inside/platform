import type { TrackVisit } from "../../features/track-visit/track-visit.js";
import type { Accounts } from "../../../accounts/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import { communicationsFailure, managementRequestSchema, type CommunicationsResult } from "../../communications-contract.js";
import { requestSchema } from "../../communications-schema.generated.js";
import type { HttpCommunicationsProvider } from "../../infrastructure/http-communications-provider.js";

export class Communications {
  constructor(
    private readonly accounts: Accounts,
    private readonly links: TelegramAccountLinks,
    private readonly provider: HttpCommunicationsProvider,
    private readonly visits?: TrackVisit,
  ) {}

  async execute(accountId: string, input: unknown): Promise<CommunicationsResult> {
    const permission = await this.accounts.checkPermission({ accountId, permission: "communications:manage" });
    if (!permission.ok && permission.error.code === "internal_error") return communicationsFailure("authorization_unavailable");
    if (!permission.ok || !permission.allowed) return communicationsFailure("forbidden");
    const parsed = managementRequestSchema.safeParse(input);
    if (!parsed.success) return communicationsFailure("invalid_input");
    const request = parsed.data;
    if (request.operation === "delivery.resolve" && request.payload.action === "retry" && !request.payload.duplicateRiskAccepted) {
      return communicationsFailure("invalid_input");
    }
    const result = await this.links.find({ accountId });
    if (!result.ok) return communicationsFailure("authorization_unavailable");
    if (result.link === null) return communicationsFailure("link_required");
    // Both intake and management use the existing confirmed linking principal.
    // The browser/delegated agent cannot select this actor or a test recipient.
    const response = await this.provider.execute(requestSchema.parse({ ...request, actor: { accountRef: result.link.accountRef } }));
    if (response.ok && request.operation === "statistics.read" && this.visits) return { ...response, trackingBacklog: await this.visits.backlog() };
    return response;
  }
}
