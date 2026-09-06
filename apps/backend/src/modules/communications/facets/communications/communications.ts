import type { PublicContentTargets } from "../../../materials/index.js";
import { validateTargets } from "../../features/validate-targets/validate-targets.js";
import type { Accounts } from "../../../accounts/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import {
  communicationsFailure,
  managementRequestSchema,
  type CommunicationsResult,
} from "../../communications-contract.js";
import { requestSchema } from "../../communications-schema.generated.js";
import type { HttpCommunicationsProvider } from "../../infrastructure/http-communications-provider.js";

export class Communications {
  constructor(
    private readonly accounts: Accounts,
    private readonly links: TelegramAccountLinks,
    private readonly provider: HttpCommunicationsProvider,
    private readonly presentation?: {
      targets: PublicContentTargets;
      publicOrigin: string | undefined;
      botStartUrl: string;
    },
  ) {}

  async execute(
    accountId: string,
    input: unknown,
  ): Promise<CommunicationsResult> {
    const permission = await this.accounts.checkPermission({
      accountId,
      permission: "communications:manage",
    });
    if (!permission.ok && permission.error.code === "internal_error")
      return communicationsFailure("authorization_unavailable");
    if (!permission.ok || !permission.allowed)
      return communicationsFailure("forbidden");
    const parsed = managementRequestSchema.safeParse(input);
    if (!parsed.success) return communicationsFailure("invalid_input");
    const request = parsed.data;
    if (
      request.operation === "delivery.resolve" &&
      request.payload.action === "retry" &&
      !request.payload.duplicateRiskAccepted
    ) {
      return communicationsFailure("invalid_input");
    }
    const result = await this.links.find({ accountId });
    if (!result.ok) return communicationsFailure("authorization_unavailable");
    if (result.link === null) return communicationsFailure("link_required");
    // Both intake and management use the existing confirmed linking principal.
    // The browser/delegated agent cannot select this actor or a test recipient.
    const providerRequest = requestSchema.parse({
      ...request,
      actor: { accountRef: result.link.accountRef },
    });
    let targetErrors: Awaited<ReturnType<typeof validateTargets>> | undefined;
    if (
      ["funnels.preview", "funnels.publish"].includes(request.operation) &&
      "funnelId" in request.payload
    ) {
      if (!this.presentation?.publicOrigin)
        return communicationsFailure("provider_unavailable");
      const loaded = await this.provider.execute(
        requestSchema.parse({
          ...providerRequest,
          operation: "funnels.read",
          operationId: crypto.randomUUID(),
          expectedRevision: 0,
          payload: { funnelId: request.payload.funnelId },
        }),
      );
      if (!loaded.ok) return loaded;
      if (!("funnel" in loaded.value))
        return communicationsFailure("provider_invalid_response");
      // A stale request may be a replay of an already committed publish. The provider owns
      // operation receipts and will either return that receipt or reject the stale revision.
      if (loaded.value.funnel.revision === request.expectedRevision) {
        const funnel = loaded.value.funnel;
        try {
          targetErrors = await validateTargets(
            [
              ...funnel.entryResponse.parts,
              ...funnel.steps.flatMap((step) => step.parts),
            ],
            this.presentation.publicOrigin,
            this.presentation.targets,
          );
        } catch {
          return communicationsFailure("provider_unavailable");
        }
        if (request.operation === "funnels.publish" && targetErrors.length > 0)
          return communicationsFailure("invalid_targets");
      }
    }
    const response = await this.provider.execute(providerRequest);
    return response.ok
      ? {
          ...response,
          ...(this.presentation
            ? { botStartUrl: this.presentation.botStartUrl }
            : {}),
          ...(targetErrors === undefined ? {} : { targetErrors }),
        }
      : response;
  }
}
