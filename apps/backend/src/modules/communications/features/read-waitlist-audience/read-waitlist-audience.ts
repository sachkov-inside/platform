import type { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { BillingPricing } from "../../../billing/index.js";
import type { ProductDirectory } from "../../../materials/index.js";
import type { ProductWaitlists } from "../../../sales-funnel/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { hasText } from "../../../../infrastructure/contracts/text.js";
import { COMMUNICATIONS_VERSION } from "../../communications-contract.js";
import type { waitlistAudienceRequestSchema } from "../../communications-schema.generated.js";
import { authorizeAuthor } from "../authorize-author/authorize-author.js";

/** Platform alone derives recipients. The trusted service may narrow a dispatch check, never add one. */
export async function readWaitlistAudience(
  dependencies: {
    readonly accounts: Accounts;
    readonly links: TelegramAccountLinks;
    readonly waitlists: ProductWaitlists;
    readonly pricing: BillingPricing;
    readonly products: ProductDirectory;
    readonly botIdentity: string;
    readonly publicOrigin: string | undefined;
  },
  request: z.infer<typeof waitlistAudienceRequestSchema>,
) {
  try {
    const authorization = await authorizeAuthor(dependencies, {
      contractVersion: COMMUNICATIONS_VERSION,
      requestId: request.requestId,
      permission: "communications:manage",
      subject: { kind: "account", accountRef: request.actorAccountRef },
    });
    if (authorization.status !== "allowed")
      return { status: authorization.status } as const;
    const author = await dependencies.links.find({
      accountRef: request.actorAccountRef,
    });
    if (!author.ok) return { status: "unavailable" } as const;
    if (author.link === null) return { status: "denied" } as const;
    const currentAuthor = await dependencies.links.findCurrentByIdentity(
      author.link.telegramIdentityRef,
    );
    if (!currentAuthor.ok) return { status: "unavailable" } as const;
    if (
      currentAuthor.state !== "found" ||
      currentAuthor.recipient.accountRef !== request.actorAccountRef
    )
      return { status: "denied" } as const;
    let productId: string;
    let active: number;
    let members: { accountRef: string; telegramIdentityRef: string }[];
    if (request.recipient !== undefined) {
      const current = await dependencies.links.findCurrentByIdentity(
        request.recipient.telegramIdentityRef,
      );
      if (!current.ok) return { status: "unavailable" } as const;
      // A vanished or transferred binding is ineligible, not a new recipient.
      if (
        current.state !== "found" ||
        current.recipient.accountRef !== request.recipient.accountRef
      )
        return { status: "denied" } as const;
      const membership = await dependencies.waitlists.notificationMembership(
        request.intakeId,
        current.recipient.accountId,
      );
      if (!membership.ok) return { status: "unavailable" } as const;
      productId = membership.value.productId;
      active = membership.value.active ? 1 : 0;
      members = membership.value.active ? [request.recipient] : [];
    } else {
      const audience = await dependencies.waitlists.notificationAudience(
        request.intakeId,
      );
      if (!audience.ok) return { status: "unavailable" } as const;
      productId = audience.value.productId;
      active = audience.value.accountIds.length;
      const bindings = await dependencies.links.readBindings(
        audience.value.accountIds,
      );
      if (!bindings.ok) return { status: "unavailable" } as const;
      const candidates = audience.value.accountIds.flatMap((accountId) => {
        const binding = bindings.bindings.get(accountId);
        return binding?.accountRef != null &&
          binding.telegramIdentityRef !== null
          ? [
              {
                accountId,
                accountRef: binding.accountRef,
                telegramIdentityRef: binding.telegramIdentityRef,
              },
            ]
          : [];
      });
      const current = await dependencies.links.findCurrentAccounts(
        candidates.map((member) => member.telegramIdentityRef),
      );
      if (!current.ok) return { status: "unavailable" } as const;
      members = candidates
        .filter(
          (member) =>
            current.accounts.get(member.telegramIdentityRef) ===
            member.accountId,
        )
        .map(({ accountRef, telegramIdentityRef }) => ({
          accountRef,
          telegramIdentityRef,
        }));
    }
    const sales = await dependencies.pricing.saleAvailability({
      productIds: [productId],
    });
    if (!sales.ok || !hasText(dependencies.publicOrigin))
      return { status: "unavailable" } as const;
    const [product] = await dependencies.products.products({
      ids: [productId],
    });
    if (product === undefined || product.archived)
      return { status: "denied" } as const;
    const purchaseUrl = new URL(
      `/products/${encodeURIComponent(product.slug)}/buy`,
      dependencies.publicOrigin,
    ).href;
    return {
      contractVersion: COMMUNICATIONS_VERSION,
      requestId: request.requestId,
      status: "ok",
      saleOpen: sales.value.items[0]?.sold === true,
      purchaseUrl,
      active,
      members,
    } as const;
  } catch (error) {
    return dependencyFailure(
      { module: "communications", operation: "readWaitlistAudience" },
      error,
      { status: "unavailable" } as const,
    );
  }
}
