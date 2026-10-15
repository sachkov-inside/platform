import {
  accessCapabilitySchema,
  productIdFromCapability,
} from "@inside/access-capabilities";
import type { CoverageCatalog } from "../../../account-rights/index.js";
import { readActivationAnnouncement } from "./read-activation-announcement.js";
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
} from "../../../account-rights/index.js";
import {
  ACTIVATION_CONTRACT_VERSION,
  invitationRedemptionOutcomeSchema,
  redeemInvitationSchema,
  type InvitationOffer,
  type InvitationRedemptionOutcome,
} from "../../../account-rights/index.js";
import { offerCheckoutPath } from "../../domain/offer-checkout.js";
import {
  isProductOffer,
  subscriptionOfferForInvitation,
  tierOpenForAssignment,
} from "../../shared/tier-composition.js";
import {
  bindingLookupQuerySchema,
  bindingSnapshotSchema,
} from "../../../account-rights/index.js";
export class SubscriptionActivation {
  constructor(
    private readonly dependencies: {
      prisma: BillingPrismaClient;
      grants: AccessGrants;
      bindings: ActivationBindings &
        Pick<RecipientLinks, "findCurrentByIdentity">;
      readConfiguredProductIds?: (
        ids: readonly string[],
      ) => Promise<readonly string[]>;
      readAdmission: (
        accountId: string,
        prepareCommunity?: boolean,
        expected?: {
          identityRef: string;
          linkRef: string;
          linkRevision: number;
        },
      ) => Promise<{
        admissionRestriction: "none" | "moderation" | "external_unknown" | null;
        state: "checking" | "no_access" | "moderation_blocked" | "ready";
      }>;
      /** Origin сайта: страница оформления Offer по приглашению лежит на нём. */
      siteOrigin?: string;
      contentCatalog?: Pick<CoverageCatalog, "resolve">;
    },
  ) {}
  async readIntent(attemptId: string) {
    try {
      const intent =
        await this.dependencies.grants.readActivationIntent(attemptId);
      if (intent === null) return { state: "unavailable" } as const;
      const product = await this.activationProduct(intent.ruleId);
      return product === null
        ? ({ state: "unavailable" } as const)
        : { state: intent.state, product };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "readIntent" },
        error,
        { state: "unavailable" } as const,
      );
    }
  }
  async readContinuation(accountId: string, attemptId: string) {
    try {
      const binding = await this.dependencies.bindings.readBinding({
        accountId,
      });
      if (!binding.ok) return { state: "unavailable" } as const;
      const result = await this.dependencies.grants.readActivationContinuation(
        attemptId,
        accountId,
        binding.binding?.telegramIdentityRef ?? null,
      );
      if (!("ruleId" in result)) return result;
      const product = await this.activationProduct(result.ruleId);
      if (product === null) return { state: "unavailable" } as const;
      return { state: result.state, product };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "readContinuation" },
        error,
        { state: "unavailable" } as const,
      );
    }
  }
  private async activationProduct(ruleId: string) {
    const rule = await this.dependencies.grants.readActivationRule(ruleId);
    if (rule === null) return null;
    const offer = await this.dependencies.prisma.billingOffer.findUnique({
      where: { id: rule.tierId },
    });
    if (offer === null || this.dependencies.contentCatalog === undefined)
      return null;
    const productIds = offer.benefits.flatMap((value) => {
      const parsed = accessCapabilitySchema.safeParse(value);
      const id = parsed.success ? productIdFromCapability(parsed.data) : null;
      return id === null ? [] : [id];
    });
    const products = await this.dependencies.contentCatalog.resolve({
      productIds,
      materialIds: [],
    });
    const product = products.find(
      (entry) =>
        entry.kind === "product" && entry.available && entry.slug !== null,
    );
    if (product === undefined || products.length !== 1) return null;
    if (product.slug === null) return null;
    return { id: product.id, slug: product.slug, name: product.title };
  }
  async announcement(input: unknown) {
    return readActivationAnnouncement(this.dependencies, input);
  }
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
    if (query.prepareCommunity === true) {
      const current = await this.dependencies.bindings.readBinding({
        accountId,
      });
      if (!current.ok)
        return { ok: false as const, error: { code: "unavailable" as const } };
      if (
        current.binding === null ||
        current.binding.linkRef !== query.linkRef ||
        current.binding.linkRevision !== query.linkRevision ||
        current.binding.telegramIdentityRef !== query.identityRef
      )
        return {
          ok: false as const,
          error: { code: "identity_conflict" as const },
        };
    }
    const [enrollments, access, admission, products] = await Promise.all([
      this.dependencies.grants.readOwnEnrollments(accountId),
      this.dependencies.grants.readOwnAccess(accountId),
      this.dependencies.readAdmission(accountId, query.prepareCommunity, query),
      query.includeProducts === true
        ? this.dependencies.grants.readOwnProducts(accountId)
        : Promise.resolve(undefined),
    ]);
    if (!enrollments.ok || !access.ok || products?.ok === false)
      return { ok: false as const, error: { code: "unavailable" as const } };
    const configuredProducts = new Set(
      products?.ok === true &&
        this.dependencies.readConfiguredProductIds !== undefined
        ? await this.dependencies.readConfiguredProductIds(
            products.value.map((product) => product.id),
          )
        : [],
    );
    return this.dependencies.prisma.$transaction(async (tx) => {
      await lockTelegramAccountBinding(tx, accountId);
      const current = await this.dependencies.bindings.readBinding(
        { accountId },
        tx,
      );
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
      return {
        ok: true as const,
        value: {
          contractVersion: query.contractVersion,
          enrollments: enrollments.value,
          grounds: access.value.grounds,
          admission,
          ...(products === undefined
            ? {}
            : {
                products: products.value.map((product) => ({
                  id: product.id,
                  slug: product.slug,
                  name: product.name,
                  materials: product.materials,
                  community:
                    product.community.state !== "available" ||
                    configuredProducts.has(product.id)
                      ? product.community
                      : { state: "unavailable" as const },
                  ...(product.slug === null ||
                  this.dependencies.siteOrigin === undefined
                    ? {}
                    : {
                        programmeUrl: new URL(
                          `/products/${encodeURIComponent(product.slug)}/programme`,
                          this.dependencies.siteOrigin,
                        ).toString(),
                      }),
                })),
              }),
        },
      };
    });
  }
  /**
   * Погашение приглашения ботом. Platform сама находит Account по текущей привязке identity и
   * читает Offer до транзакции прав; права закрепляют и допускают в одной транзакции.
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
            };
      const result = await grants.redeemInvitation(parsed.data, {
        accountId: linked.state === "found" ? linked.recipient.accountId : null,
        offer,
      });
      if (!result.ok) {
        // Запрос уже прошёл схему, а идентичность — проверку выше: другой отказ назначения —
        // нарушенный инвариант прав, и его причина записывается как сбой зависимости.
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
      const result = await this.dependencies.grants.beginActivation(input);
      if (!result.ok || result.value.rule === undefined) return result;
      const product = await this.activationProduct(result.value.rule.id);
      return {
        ok: true as const,
        value: {
          contractVersion: result.value.contractVersion,
          attemptId: result.value.attemptId,
          state: result.value.state,
          enrollment: result.value.enrollment,
          rule: {
            id: result.value.rule.id,
            revision: result.value.rule.revision,
            sourceRef: result.value.rule.sourceRef,
            ...(result.value.rule.verificationMode === undefined
              ? {}
              : { verificationMode: result.value.rule.verificationMode }),
            ...(product === null ? {} : { product }),
          },
        },
      };
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
    const linked = await this.dependencies.bindings.find({
      accountRef: parsed.data.accountRef,
    });
    return this.dependencies.prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      const row = await tx.billingOffer.findUnique({
        where: { id: rule.tierId },
      });
      if (row === null || !isProductOffer(row) || !tierOpenForAssignment(row))
        return { ok: false as const, error: { code: "not_found" as const } };
      if (row.revision !== rule.tierRevision)
        return {
          ok: false as const,
          error: { code: "revision_conflict" as const },
        };
      return this.dependencies.grants.activateSubscription(
        tx,
        this.dependencies.bindings,
        linked,
        parsed.data,
        {
          id: row.id,
          revision: row.revision,
          name: row.name,
          benefits: row.benefits,
          benefitPeriods: row.benefitPeriods,
          coverage: row.coverage ?? { productIds: [], materialIds: [] },
        },
      );
    });
  }
}
