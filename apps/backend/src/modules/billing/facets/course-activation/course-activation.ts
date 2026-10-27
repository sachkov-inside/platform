import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { CoverageCatalog } from "../../../account-rights/index.js";
import { readActivationAnnouncement } from "./read-activation-announcement.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockTelegramAccountBinding,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import {
  ownCourseAccessQuerySchema,
  activationEvidenceSchema,
  type AccessGrants,
  type ActivationBindings,
  type RecipientLinks,
} from "../../../account-rights/index.js";
import {
  bindingLookupQuerySchema,
  bindingSnapshotSchema,
} from "../../../account-rights/index.js";
export class CourseActivation {
  constructor(
    private readonly dependencies: {
      prisma: BillingPrismaClient;
      grants: AccessGrants;
      bindings: ActivationBindings &
        Pick<RecipientLinks, "findCurrentByIdentity">;
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
      /** Public origin for Product programme navigation. */
      siteOrigin?: string;
      contentCatalog?: Pick<CoverageCatalog, "resolve">;
    },
  ) {}
  async readIntent(attemptId: string) {
    try {
      const intent =
        await this.dependencies.grants.readActivationIntent(attemptId);
      if (intent === null) return { state: "unavailable" } as const;
      const product = await this.activationProduct(
        intent.ruleId,
        intent.ruleRevision,
      );
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
      const result = await this.dependencies.prisma.$transaction(async (tx) => {
        await lockTelegramAccountBinding(tx, accountId);
        const handle = transactionHandle(tx);
        const binding = await this.dependencies.bindings.readBinding(
          { accountId },
          handle,
        );
        if (!binding.ok) return { state: "unavailable" } as const;
        return this.dependencies.grants.readActivationContinuation(
          attemptId,
          accountId,
          binding.binding?.telegramIdentityRef ?? null,
          binding.binding ?? undefined,
          handle,
        );
      });
      if (!("ruleId" in result)) return result;
      const product = await this.activationProduct(
        result.ruleId,
        result.ruleRevision,
      );
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
  private async activationProduct(ruleId: string, expectedRevision?: number) {
    const rule = await this.dependencies.grants.readActivationRule(ruleId);
    if (
      rule === null ||
      (expectedRevision !== undefined && rule.revision !== expectedRevision)
    )
      return null;
    if (this.dependencies.contentCatalog === undefined) return null;
    const productIds = [rule.productId];
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
    const parsed = ownCourseAccessQuerySchema.safeParse(input);
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
    return this.dependencies.prisma.$transaction(async (tx) => {
      await lockTelegramAccountBinding(tx, accountId);
      const current = await this.dependencies.bindings.readBinding(
        { accountId },
        transactionHandle(tx),
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
                  community: product.community,
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
    const product = await this.activationProduct(rule.id);
    if (product === null)
      return { ok: false as const, error: { code: "not_found" as const } };
    return this.dependencies.prisma.$transaction(async (tx) => {
      return this.dependencies.grants.activateSubscription(
        transactionHandle(tx),
        this.dependencies.bindings,
        linked,
        parsed.data,
        { id: product.id },
      );
    });
  }
}
