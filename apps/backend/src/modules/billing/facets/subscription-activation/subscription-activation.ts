import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockBillingPricing,
  lockTelegramAccountBinding,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import {
  ownSubscriptionAccessQuerySchema,
  activationEvidenceSchema,
  type AccessGrants,
  type ActivationBindings,
  type RecipientLinks,
} from "../../../membership-entitlements/index.js";
import {
  ACTIVATION_CONTRACT_VERSION,
  invitationRedemptionOutcomeSchema,
  redeemInvitationSchema,
  tierSnapshotSchema,
  type InvitationOffer,
  type InvitationRedemptionOutcome,
} from "../../../membership-entitlements/index.js";
import { offerCheckoutPath } from "../../domain/offer-checkout.js";
import { subscriptionPeriodEnd } from "../../domain/subscription-period.js";
import {
  subscriptionOfferForInvitation,
  tierOpenForAssignment,
} from "../../shared/tier-composition.js";
import {
  bindingLookupQuerySchema,
  bindingSnapshotSchema,
} from "../../../membership-entitlements/index.js";
export class SubscriptionActivation {
  constructor(
    private readonly dependencies: {
      prisma: BillingPrismaClient;
      grants: AccessGrants;
      bindings: ActivationBindings &
        Pick<RecipientLinks, "findCurrentByIdentity">;
      readAdmission: (accountId: string) => Promise<{
        admissionRestriction: "none" | "moderation" | "external_unknown" | null;
        state: "checking" | "no_access" | "moderation_blocked" | "ready";
      }>;
      /** Origin сайта: страница оформления Offer по приглашению лежит на нём. */
      siteOrigin?: string;
    },
  ) {}
  /** An observation, not a reservation: evidence and own-access still validate the exact binding. */
  async lookupBinding(input: unknown) {
    const parsed = bindingLookupQuerySchema.safeParse(input);
    if (!parsed.success)
      return { ok: false as const, error: { code: "invalid_input" as const } };
    try {
      const result = await this.dependencies.bindings.findCurrentByIdentity(
        parsed.data.identityRef,
      );
      if (!result.ok)
        return { ok: false as const, error: { code: "unavailable" as const } };
      if (result.state === "ambiguous")
        return {
          ok: false as const,
          error: { code: "identity_conflict" as const },
        };
      if (result.state === "not_found")
        return {
          ok: true as const,
          value: {
            contractVersion: parsed.data.contractVersion,
            state: "unlinked" as const,
          },
        };
      // Explicit projection keeps the internal Account UUID outside the source-authority contract.
      const binding = bindingSnapshotSchema.safeParse({
        accountRef: result.recipient.accountRef,
        identityRef: result.recipient.identityRef,
        linkRef: result.recipient.linkRef,
        linkRevision: result.recipient.linkRevision,
      });
      if (!binding.success)
        return { ok: false as const, error: { code: "unavailable" as const } };
      if (binding.data.identityRef !== parsed.data.identityRef)
        return {
          ok: false as const,
          error: { code: "identity_conflict" as const },
        };
      return {
        ok: true as const,
        value: {
          contractVersion: parsed.data.contractVersion,
          state: "linked" as const,
          binding: binding.data,
        },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "lookupBinding" },
        error,
        { ok: false as const, error: { code: "unavailable" as const } },
      );
    }
  }
  async readOwn(input: unknown) {
    const parsed = ownSubscriptionAccessQuerySchema.safeParse(input);
    if (!parsed.success)
      return { ok: false as const, error: { code: "invalid_input" as const } };
    const query = parsed.data;
    const linked = await this.dependencies.bindings.find({
      accountRef: query.accountRef,
    });
    if (!linked.ok)
      return { ok: false as const, error: { code: "unavailable" as const } };
    if (
      linked.link === null ||
      linked.link.telegramIdentityRef !== query.identityRef
    )
      return {
        ok: false as const,
        error: { code: "identity_conflict" as const },
      };
    const accountId = linked.link.accountId;
    return this.dependencies.prisma.$transaction(async (tx) => {
      await lockTelegramAccountBinding(tx, accountId);
      const current = await this.dependencies.bindings.readBinding({
        accountId,
      });
      if (
        !current.ok ||
        current.binding === null ||
        current.binding.linkRef !== query.linkRef ||
        current.binding.linkRevision !== query.linkRevision ||
        current.binding.telegramIdentityRef !== query.identityRef
      )
        return {
          ok: false as const,
          error: { code: "identity_conflict" as const },
        };
      const [enrollments, access] = await Promise.all([
        this.dependencies.grants.readOwnEnrollments(accountId),
        this.dependencies.grants.readOwnAccess(accountId),
      ]);
      if (!enrollments.ok || !access.ok)
        return { ok: false as const, error: { code: "unavailable" as const } };
      return {
        ok: true as const,
        value: {
          contractVersion: query.contractVersion,
          enrollments: enrollments.value,
          grounds: access.value.grounds,
          admission: await this.dependencies.readAdmission(accountId),
        },
      };
    });
  }
  /**
   * Погашение приглашения ботом. Platform сама находит Account по текущей привязке identity и
   * читает Offer до транзакции прав; права закрепляют, допускают или дарят в одной транзакции.
   */
  async redeemInvitation(input: unknown) {
    const unavailable = {
      ok: false as const,
      error: { code: "unavailable" as const },
    };
    const parsed = redeemInvitationSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false as const, error: { code: "invalid_input" as const } };
    const { siteOrigin, grants, bindings } = this.dependencies;
    try {
      const linked = await bindings.findCurrentByIdentity(
        parsed.data.identityRef,
      );
      if (!linked.ok) return unavailable;
      if (linked.state === "ambiguous")
        return {
          ok: false as const,
          error: { code: "identity_conflict" as const },
        };
      const target = await grants.readInvitationTarget(parsed.data.code);
      const row =
        target === null
          ? null
          : await this.dependencies.prisma.billingOffer.findUnique({
              where: { id: target.offerId },
              include: {
                options: {
                  where: { archived: false, mode: "subscription" },
                  select: { id: true },
                },
              },
            });
      const offer: InvitationOffer | null =
        row === null
          ? null
          : {
              id: row.id,
              purchasable:
                !row.archived &&
                row.published &&
                row.options.length > 0 &&
                subscriptionOfferForInvitation(row),
              tier: tierOpenForAssignment(row)
                ? tierSnapshotSchema.parse({
                    id: row.id,
                    revision: row.revision,
                    name: row.name,
                    benefits: row.benefits,
                    contentScope: row.contentScope,
                  })
                : null,
            };
      const result = await grants.redeemInvitation(parsed.data, {
        accountId: linked.state === "found" ? linked.recipient.accountId : null,
        offer,
        periodEnd: subscriptionPeriodEnd,
      });
      if (!result.ok) {
        // Запрос уже прошёл схему, а идентичность — проверку выше: другой отказ назначения —
        // нарушенный инвариант прав, и его причина записывается как сбой зависимости.
        if (result.error.code === "identity_conflict")
          return {
            ok: false as const,
            error: { code: "identity_conflict" as const },
          };
        throw new Error(
          `Invitation redemption refused with ${result.error.code}`,
        );
      }
      const redemption = result.value;
      const contractVersion = ACTIVATION_CONTRACT_VERSION;
      let value: InvitationRedemptionOutcome;
      if (!("mode" in redemption))
        value = { contractVersion, state: redemption.state };
      else if (row === null)
        throw new Error("Redeemed invitation lost its Offer");
      else if (redemption.mode === "gift")
        value = {
          contractVersion,
          state: redemption.state,
          mode: "gift",
          offerName: row.name,
          enrollment: redemption.enrollment,
        };
      else {
        if (siteOrigin === undefined)
          throw new Error("Invitation checkout needs the public site origin");
        const checkoutUrl = new URL(offerCheckoutPath(row.id), siteOrigin);
        value = {
          contractVersion,
          state: redemption.state,
          mode: "purchase",
          offerName: row.name,
          checkoutUrl: checkoutUrl.toString(),
        };
      }
      return {
        ok: true as const,
        value: invitationRedemptionOutcomeSchema.parse(value),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "redeemInvitation" },
        error,
        unavailable,
      );
    }
  }
  async begin(input: unknown) {
    try {
      return await this.dependencies.grants.beginActivation(input);
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "begin" },
        error,
        { ok: false as const, error: { code: "unavailable" as const } },
      );
    }
  }
  async accept(input: unknown) {
    try {
      return await this.acceptConfirmedInput(input);
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "accept" },
        error,
        { ok: false as const, error: { code: "unavailable" as const } },
      );
    }
  }
  private async acceptConfirmedInput(input: unknown) {
    const parsed = activationEvidenceSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false as const, error: { code: "invalid_input" as const } };
    const receipt = await this.dependencies.grants.readActivationReceipt(
      parsed.data,
    );
    if (receipt !== null) return receipt;
    const rule = await this.dependencies.grants.readActivationRule(
      parsed.data.ruleId,
    );
    if (rule === null)
      return { ok: false as const, error: { code: "not_found" as const } };
    return this.dependencies.prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      const row = await tx.billingOffer.findUnique({
        where: { id: rule.tierId },
      });
      if (row === null || !tierOpenForAssignment(row))
        return { ok: false as const, error: { code: "not_found" as const } };
      if (row.revision !== rule.tierRevision)
        return {
          ok: false as const,
          error: { code: "revision_conflict" as const },
        };
      return this.dependencies.grants.activateSubscription(
        this.dependencies.bindings,
        parsed.data,
        {
          id: row.id,
          revision: row.revision,
          name: row.name,
          benefits: row.benefits,
          contentScope: row.contentScope,
        },
      );
    });
  }
}
