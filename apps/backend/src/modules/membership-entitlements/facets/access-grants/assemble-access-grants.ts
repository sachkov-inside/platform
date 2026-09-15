import { tributeStateSchema } from "../../domain/tribute-source.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import { contentScopeSchema, guideCapability } from "@inside/access-capabilities";
import { Prisma } from "../../../../infrastructure/prisma/index.js";
import type { ContentScopeCatalog } from "../../../materials/index.js";
import { enrollmentView, enrollmentBenefitTerms, enrollmentSourceState } from "../../shared/enrollment-view.js";
import { registerSourceEntitlement } from "../../features/register-source-entitlement/register-source-entitlement.js";
import { manageActivationRule } from "../../features/manage-activation-rule/manage-activation-rule.js";
import { beginActivation, activateSubscription, readActivationReceipt } from "../../features/activate-subscription/activate-subscription.js";
import { activationRuleSchema, type ActivationBindings } from "../../domain/subscription-activation.js";
import { previewEnrollmentExpansion, applyEnrollmentExpansion } from "../../features/expand-enrollments/expand-enrollments.js";
import { accessFingerprint } from "../../shared/access-receipts.js";
import { assignEnrollment } from "../../features/assign-enrollment/assign-enrollment.js";
import { changeEnrollment } from "../../features/change-enrollment/change-enrollment.js";
import { assignEnrollmentSchema, enrollmentResultSchema } from "../../domain/subscription-enrollment.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-lock.js";
import { z } from "zod";
import { accountId, type Accounts, type PlatformPermission } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import {
  accessFailure,
  classificationSchema,
  recurringAllowedFor,
} from "../../domain/access-grant.js";
import {
  applyPaidPeriod,
  type ApplyPaidPeriodCommand,
} from "../../features/apply-paid-period/apply-paid-period.js";
import {
  previewGrantBatch,
  type PreviewGrantBatchCommand,
} from "../../features/preview-grant-batch/preview-grant-batch.js";
import {
  applyGrantBatch,
  type ApplyGrantBatchCommand,
} from "../../features/apply-grant-batch/apply-grant-batch.js";
import {
  changeAccessGrant,
  type ChangeAccessGrantCommand,
} from "../../features/change-access-grant/change-access-grant.js";
import {
  classifyLegacyAccount,
  type ClassifyLegacyAccountCommand,
} from "../../features/classify-legacy-account/classify-legacy-account.js";
import { resolveAccessCapabilities } from "../../features/resolve-access-capabilities/resolve-access-capabilities.js";
import {
  listAccessGrants,
  type ListAccessGrantsCommand,
} from "../../features/list-access-grants/list-access-grants.js";
import { readOwnAccess } from "../../features/read-own-access/read-own-access.js";

export interface AccessGrantsDependencies {
  readonly prisma: MembershipEntitlementsPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission" | "readIdentityForLink">;
  readonly recipientLinks?: Pick<TelegramAccountLinks, "findCurrentByIdentity" | "readBinding">;
  readonly contentCatalog?: Pick<ContentScopeCatalog, "resolve" | "list">;
  readonly clock?: () => Date;
}
// Internal capability for billing fulfillment, owner operations (#409), and community projection (#415).
// Actor comes from the delegated adapter, outside the command payload. Grant operations share the
// scoped billing:manage permission with the billing admin surface; platform:admin includes it.
export function assembleAccessGrants(dependencies: AccessGrantsDependencies) {
  const { prisma, accounts } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  /**
   * Классификация Account: состояние, его revision и вывод о допустимости автосписаний.
   * Отсутствующая запись — это «неизвестно», а не ошибка чтения.
   */
  async function readClassificationOf(targetAccountId: string) {
    if (!z.uuid().safeParse(targetAccountId).success)
      return accessFailure("invalid_input");
    try {
      const row = await prisma.legacyClassification.findUnique({
        where: { accountId: targetAccountId },
      });
      const classification = classificationSchema.parse(
        row?.classification ?? "unknown",
      );
      const externalSources = await prisma.sourceEntitlement.findMany({ where: { origin: "tribute", accountId: targetAccountId }, take: 1001 });
      const oldChargingStopped = externalSources.length <= 1000 && externalSources.every(source => {
        const state = tributeStateSchema.safeParse(source.tributeState);
        return state.success && state.data.renewal === "stopped";
      });
      return {
        ok: true as const,
        classification,
        revision: row?.revision ?? 0,
        recurringAllowed: oldChargingStopped && recurringAllowedFor({
          classification,
          tributeStopped: row?.tributeStopped === true,
        }),
      };
    } catch {
      return accessFailure("unavailable");
    }
  }
  async function manage<Result>(
    actorId: string,
    permission: PlatformPermission,
    operation: () => Promise<Result>,
  ) {
    try {
      if (!z.uuid().safeParse(actorId).success)
        return accessFailure("invalid_input");
      const decision = await accounts.checkPermission({
        accountId: actorId,
        permission,
      });
      if (!decision.ok) return accessFailure("unavailable");
      if (!decision.allowed) return accessFailure("forbidden");
      return await operation();
    } catch {
      return accessFailure("unavailable");
    }
  }
  return Object.freeze({
    lookupRecipient: (actorId: string, identityRef: string) => manage(actorId, "billing:manage", async () => {
      if (!z.string().trim().min(1).max(256).safeParse(identityRef).success) return accessFailure("invalid_input");
      const result = await dependencies.recipientLinks?.findCurrentByIdentity(identityRef);
      if (result === undefined || !result.ok) return accessFailure("unavailable");
      if (result.state === "found" && await accounts.readIdentityForLink(result.recipient.accountId) === undefined)
        return { ok: true as const, state: "not_found" as const };
      return result;
    }),
    readEnrollmentAssignmentReceipt: (actorId: string, input: unknown) =>
      manage(actorId, "billing:manage", async () => {
        const command = assignEnrollmentSchema.safeParse(input);
        if (!command.success) return accessFailure("invalid_input");
        const receipt = await prisma.accessReceipt.findUnique({ where: { scope_operationId: { scope: actorId, operationId: command.data.operationId } } });
        if (receipt === null) return null;
        return receipt.fingerprint === accessFingerprint({ action: "assignEnrollment", command: command.data })
          ? enrollmentResultSchema.parse(receipt.result) : accessFailure("operation_conflict");
      }),
    readActivationReceipt: (input: unknown) => readActivationReceipt(prisma, input),
    previewEnrollmentExpansion: (actorId: string, input: unknown, tier: unknown) =>
      manage(actorId, "billing:manage", () => previewEnrollmentExpansion(prisma, actorId, input, tier, clock())),
    applyEnrollmentExpansion: (actorId: string, input: unknown) =>
      manage(actorId, "billing:manage", () => applyEnrollmentExpansion(prisma, actorId, input, clock())),
    assignEnrollment: (actorId: string, command: unknown, snapshot: unknown) =>
      manage(actorId, "billing:manage", async () => {
        const parsed = assignEnrollmentSchema.safeParse(command);
        if (!parsed.success) return accessFailure("invalid_input");
        if (await accounts.readIdentityForLink(parsed.data.accountId) === undefined) return accessFailure("not_found");
        return assignEnrollment(prisma, actorId, parsed.data, snapshot, clock(), dependencies.recipientLinks);
      }),
    changeEnrollment: (actorId: string, command: unknown) =>
      manage(actorId, "billing:manage", () => changeEnrollment(prisma, actorId, command, clock())),
    registerSourceEntitlement: (actorId: string, input: unknown) => manage(actorId, "billing:manage", () => registerSourceEntitlement(prisma, actorId, input, clock())),
    manageActivationRule: (actorId: string, input: unknown) =>
      manage(actorId, "billing:manage", () => manageActivationRule(prisma, actorId, input, clock())),
    listActivationRules: (actorId: string) => manage(actorId, "billing:manage", async () => {
      const rows = await prisma.activationRule.findMany({ orderBy: { id: "asc" } });
      return { ok: true as const, value: rows.map(row => activationRuleSchema.parse({ id: row.id, code: row.code,
        name: row.name, revision: row.revision, tierId: row.tierId, tierRevision: row.tierRevision, sourceRef: row.sourceRef, verificationMode: row.verificationMode,
        published: row.published, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt?.toISOString() ?? null })) };
    }),
    async readActivationRule(ruleId: string) {
      if (!z.uuid().safeParse(ruleId).success) return null;
      const row = await prisma.activationRule.findUnique({ where: { id: ruleId } });
      return row === null ? null : activationRuleSchema.parse({ id: row.id, code: row.code, name: row.name, revision: row.revision, tierId: row.tierId, tierRevision: row.tierRevision, sourceRef: row.sourceRef, verificationMode: row.verificationMode, published: row.published, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt?.toISOString() ?? null });
    },
    beginActivation: (input: unknown) => beginActivation(prisma, input, clock()),
    activateSubscription: (bindings: ActivationBindings, input: unknown, tier: unknown) => activateSubscription(prisma, bindings, input, tier, clock()),
    async readOwnEnrollments(targetAccountId: string) {
      if (!z.uuid().safeParse(targetAccountId).success) return accessFailure("invalid_input");
      try {
        const now = clock();
        const rows = await prisma.subscriptionEnrollment.findMany({ where: { accountId: targetAccountId }, orderBy: [{ startsAt: "desc" }, { id: "asc" }] });
        return { ok: true as const, value: await Promise.all(rows.map(async row => { const view = enrollmentView(row, now); if (row.origin === "tribute" && view.state !== "revoked") view.state = await enrollmentSourceState(prisma, row.id, now) ?? view.state; const benefitGrants = await prisma.accessGrant.findMany({ where: { enrollmentId: row.id } }); return { ...view, benefitTerms: enrollmentBenefitTerms(benefitGrants), ...(dependencies.contentCatalog === undefined ? {} : { content: await dependencies.contentCatalog.resolve(view.tier.contentScope) }) }; })) };
      } catch { return accessFailure("unavailable"); }
    },
    async readCompatibilityContentScope() {
      const rows = z.array(z.object({ scope: contentScopeSchema })).parse(await prisma.$queryRaw`SELECT scope FROM membership_entitlements.content_scope_baseline WHERE id = 1`);
      const row = rows[0]; if (row === undefined) throw new Error("Compatibility scope baseline missing");
      return row.scope;
    },
    readContentCatalog: (actorId: string) => manage(actorId, "billing:manage", async () => {
      if (dependencies.contentCatalog === undefined) return accessFailure("unavailable");
      return { ok: true as const, value: await dependencies.contentCatalog.list() };
    }),
    listEnrollments: (actorId: string, targetAccountId: string) =>
      manage(actorId, "billing:manage", async () => {
        if (!z.uuid().safeParse(targetAccountId).success) return accessFailure("invalid_input");
        const now = clock();
        const rows = await prisma.subscriptionEnrollment.findMany({ where: { accountId: targetAccountId }, orderBy: { id: "asc" } });
        return { ok: true as const, value: await Promise.all(rows.map(async row => { const view = enrollmentView(row, now); if (row.origin === "tribute" && view.state !== "revoked") view.state = await enrollmentSourceState(prisma, row.id, now) ?? view.state; const benefitGrants = await prisma.accessGrant.findMany({ where: { enrollmentId: row.id } }); const changes = await prisma.accessChange.findMany({ where: { accountId: targetAccountId, grantId: { in: benefitGrants.map(grant => grant.id) } }, orderBy: { revision: "desc" }, take: 100 }); return { ...view, benefitTerms: enrollmentBenefitTerms(benefitGrants), history: changes.map(change => ({ kind: change.kind, reason: change.reason, recordedAt: change.recordedAt.toISOString() })), ...(dependencies.contentCatalog === undefined ? {} : { content: await dependencies.contentCatalog.resolve(view.tier.contentScope) }) }; })) };
      }),
    async applyPaidPeriod(command: ApplyPaidPeriodCommand) {
      try {
        return await applyPaidPeriod(prisma, accounts, command, clock());
      } catch {
        return accessFailure("unavailable");
      }
    },
    previewBatch: (actorId: string, command: PreviewGrantBatchCommand) =>
      manage(actorId, "billing:manage", () =>
        previewGrantBatch(prisma, accounts, actorId, command, clock()),
      ),
    applyBatch: (actorId: string, command: ApplyGrantBatchCommand) =>
      manage(actorId, "billing:manage", () =>
        applyGrantBatch(prisma, accounts, actorId, command, clock()),
      ),
    changeGrant: (actorId: string, command: ChangeAccessGrantCommand) =>
      manage(actorId, "billing:manage", () =>
        changeAccessGrant(prisma, actorId, command, clock()),
      ),
    listGrants: (actorId: string, command: ListAccessGrantsCommand) =>
      manage(actorId, "billing:manage", () => listAccessGrants(prisma, command, clock())),
    // Классификация решает, разрешены ли автосписания, поэтому входит в тот же владельческий
    // набор billing и проверяет то же `billing:manage`, что каталог, платежи и ручные права.
    classifyLegacy: (actorId: string, command: ClassifyLegacyAccountCommand) =>
      manage(actorId, "billing:manage", () =>
        classifyLegacyAccount(prisma, accounts, actorId, command, clock()),
      ),
    /** Владельческое чтение: та же проверка `billing:manage`, что у остальных операций набора. */
    readClassification: (actorId: string, targetAccountId: string) =>
      manage(actorId, "billing:manage", () =>
        readClassificationOf(targetAccountId),
      ),
    /**
     * Сколько Account сейчас держат действующее право на каждое руководство: купленное
     * руководство или право на материалы, в составе которого оно есть. Materials спрашивает об
     * этом перед снятием опубликованного материала из руководства. Прежний мост членства сюда не
     * входит: он читает замороженный состав миграции и новых руководств не содержит.
     */
    async countGuideHolders(guideIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
      const ids = z.array(z.uuid()).max(100).parse([...new Set(guideIds)]);
      if (ids.length === 0) return new Map();
      const now = clock();
      const rows = z.array(z.object({ guide_id: z.uuid(), holders: z.number().int().nonnegative() })).parse(
        await prisma.$queryRaw(Prisma.sql`
          select guide.id as guide_id, count(distinct grant_row.account_id)::integer as holders
          from unnest(${ids}::uuid[], ${ids.map(guideCapability)}::text[]) as guide(id, capability)
          join membership_entitlements.access_grants as grant_row
            on grant_row.revoked_at is null
           and grant_row.starts_at <= ${now}
           and (grant_row.valid_until is null or grant_row.valid_until > ${now})
           and (
             grant_row.capabilities @> array[guide.capability]
             or (
               grant_row.capabilities @> array['materials']::text[]
               and coalesce(grant_row.content_scope -> 'guideIds', '[]'::jsonb) ? guide.id::text
             )
           )
          group by guide.id
        `),
      );
      return new Map(ids.map((id) => [id, rows.find((row) => row.guide_id === id)?.holders ?? 0]));
    },
    /** Собственные основания Account: без полномочия владельца и без операторских полей. */
    async readOwnAccess(targetAccountId: string) {
      try {
        return await readOwnAccess(prisma, targetAccountId, clock());
      } catch {
        return accessFailure("unavailable");
      }
    },
    async resolveCapabilities(targetAccountId: string) {
      if (!z.uuid().safeParse(targetAccountId).success)
        return accessFailure("invalid_input");
      try {
        return await prisma.$transaction(async (transaction) => {
          await setAccessSnapshotIsolation(transaction);
          const { capabilities, revision, nextBoundary } =
            await resolveAccessCapabilities(
              transaction,
              accountId(targetAccountId),
              clock(),
            );
          return { ok: true as const, capabilities, revision, nextBoundary };
        });
      } catch {
        return accessFailure("unavailable");
      }
    },
    /**
     * Ordered audit cursor for projectors that must not miss an access change.
     * It reports which Accounts changed, never why or with which capabilities.
     */
    async readChangedAccounts(query: {
      readonly afterRevision: number;
      readonly limit: number;
    }) {
      const parsed = z
        .object({
          afterRevision: z.number().int().min(0),
          limit: z.number().int().min(1).max(500),
        })
        .strict()
        .safeParse(query);
      if (!parsed.success) return accessFailure("invalid_input");
      try {
        const rows = await prisma.accessChange.findMany({
          where: { revision: { gt: parsed.data.afterRevision } },
          orderBy: { revision: "asc" },
          take: parsed.data.limit,
          select: { accountId: true, revision: true },
        });
        return {
          ok: true as const,
          accountIds: [...new Set(rows.map((row) => row.accountId))],
          cursor: rows.at(-1)?.revision ?? parsed.data.afterRevision,
        };
      } catch {
        return accessFailure("unavailable");
      }
    },
    /**
     * Внутреннее чтение billing без полномочия владельца: покупка проверяет legacy gate
     * своего же Account. Владельческий путь — `readClassification` выше.
     */
    readLegacyClassification: (targetAccountId: string) =>
      readClassificationOf(targetAccountId),
  });
}
export type AccessGrants = ReturnType<typeof assembleAccessGrants>;
