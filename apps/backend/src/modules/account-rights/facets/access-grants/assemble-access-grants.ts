import { z } from "zod";
import {
  transactionHandle,
  type TransactionHandle,
} from "../../../../infrastructure/prisma/transaction-handle.js";
import {
  reportDependencyFailure,
  dependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import {
  accountRightsTransaction,
  type AccountRightsPrisma,
  type AccountRightsPrismaClient,
} from "../../infrastructure/prisma.js";
import type { Accounts, PlatformPermission } from "../../../accounts/index.js";
import { accountId } from "../../../accounts/index.js";
import { accessFailure } from "../../domain/access-grant.js";
import {
  activationRuleSchema,
  type ActivationBindings,
} from "../../domain/course-activation.js";
import type { RecipientLinks } from "../../ports/recipient-links.js";
import type { CoverageCatalog } from "../../ports/coverage-catalog.js";
import { issueProductAccess } from "../../features/issue-product-access/issue-product-access.js";
import type {
  IssueProductAccessCommand,
  ProductAccessContext,
} from "../../domain/product-access.js";
import {
  previewProductRevocation,
  changeProductAccess,
} from "../../features/revoke-product-access/revoke-product-access.js";
import { registerSourceEntitlement } from "../../features/register-source-entitlement/register-source-entitlement.js";
import { manageActivationRule } from "../../features/manage-activation-rule/manage-activation-rule.js";
import {
  beginActivation,
  activateCourse,
  readActivationReceipt,
} from "../../features/activate-course/activate-course.js";
import {
  readActivationContinuation,
  readActivationIntent,
} from "../../features/activate-course/read-activation-continuation.js";
import {
  resolveAccessCapabilities,
  resolveAccessCapabilitiesForAccounts,
  readAccessCapabilityFacts,
  projectAccessCapabilities,
} from "../../features/resolve-access-capabilities/resolve-access-capabilities.js";
import { readOwnAccess } from "../../features/read-own-access/read-own-access.js";
import { readOwnProducts } from "../../features/read-own-products/read-own-products.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-isolation.js";
import {
  productAccessViewSchema,
  productAccessListQuerySchema,
  productAccessTargetSchema,
} from "../../domain/product-access.js";
export interface AccessGrantsDependencies {
  readonly prisma: AccountRightsPrismaClient;
  readonly accounts: Pick<
    Accounts,
    "checkPermission" | "readIdentityForLink" | "readIdentitiesForLink"
  >;
  readonly recipientLinks?: RecipientLinks;
  readonly contentCatalog?: CoverageCatalog;
  readonly clock?: () => Date;
}
export function assembleAccessGrants(dependencies: AccessGrantsDependencies) {
  const { prisma, accounts } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  async function manage<Result>(
    actorId: string,
    permission: PlatformPermission,
    operation: () => Promise<Result>,
    operationName = "manage",
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
    } catch (error) {
      return dependencyFailure(
        { module: "account-rights", operation: operationName },
        error,
        accessFailure("unavailable"),
      );
    }
  }
  function inTransaction<Result>(
    handle: TransactionHandle | undefined,
    operation: (transaction: AccountRightsPrisma) => Promise<Result>,
  ) {
    return handle === undefined
      ? prisma.$transaction(operation)
      : operation(accountRightsTransaction(handle));
  }
  async function manageTransaction<Result>(
    actorId: string,
    permission: PlatformPermission,
    handle: TransactionHandle | undefined,
    operation: (transaction: AccountRightsPrisma) => Promise<Result>,
    operationName: string,
  ) {
    try {
      return await inTransaction(handle, async (transaction) => {
        if (!z.uuid().safeParse(actorId).success)
          return accessFailure("invalid_input");
        const decision = await accounts.checkPermission(
          { accountId: actorId, permission },
          transactionHandle(transaction),
        );
        if (!decision.ok) return accessFailure("unavailable");
        if (!decision.allowed) return accessFailure("forbidden");
        return operation(transaction);
      });
    } catch (error) {
      reportDependencyFailure(
        { module: "account-rights", operation: operationName },
        error,
      );
      throw error;
    }
  }
  return Object.freeze({
    issueProductAccess: (
      context: ProductAccessContext,
      command: IssueProductAccessCommand,
      handle?: TransactionHandle,
    ) =>
      inTransaction(handle, (tx) =>
        issueProductAccess(tx, accounts, context, command, clock()),
      ),
    lookupRecipient: (actorId: string, identityRef: string) =>
      manage(actorId, "billing:manage", async () => {
        if (!z.string().trim().min(1).max(256).safeParse(identityRef).success)
          return accessFailure("invalid_input");
        const result =
          await dependencies.recipientLinks?.findCurrentByIdentity(identityRef);
        if (result === undefined || !result.ok)
          return accessFailure("unavailable");
        if (
          result.state === "found" &&
          (await accounts.readIdentityForLink(result.recipient.accountId)) ===
            undefined
        )
          return { ok: true as const, state: "not_found" as const };
        return result;
      }),
    registerSourceEntitlement: (actorId: string, input: unknown) =>
      manage(actorId, "billing:manage", () =>
        registerSourceEntitlement(prisma, actorId, input, clock()),
      ),
    manageActivationRule: (
      actorId: string,
      input: unknown,
      handle?: TransactionHandle,
    ) =>
      manageTransaction(
        actorId,
        "billing:manage",
        handle,
        (tx) => manageActivationRule(tx, actorId, input, clock()),
        "manageActivationRule",
      ),
    listActivationRules: (actorId: string) =>
      manage(actorId, "billing:manage", async () => {
        const rows = await prisma.activationRule.findMany({
          orderBy: { id: "asc" },
        });
        return {
          ok: true as const,
          value: rows
            .filter((row) => row.productId !== null)
            .map((row) =>
              activationRuleSchema.parse({
                id: row.id,
                code: row.code,
                name: row.name,
                revision: row.revision,
                productId: row.productId,
                sourceRef: row.sourceRef,
                verificationMode: row.verificationMode,
                published: row.published,
                startsAt: row.startsAt.toISOString(),
                endsAt: row.endsAt?.toISOString() ?? null,
              }),
            ),
        };
      }),
    /** Read-only metadata for an owner sample; never creates an activation attempt. */
    async readAnnouncementRule(code: string) {
      const now = clock();
      const rule = await prisma.activationRule.findUnique({ where: { code } });
      if (
        rule?.productId == null ||
        !rule.published ||
        rule.verificationMode !== "course_membership" ||
        rule.startsAt > now ||
        (rule.endsAt !== null && rule.endsAt <= now)
      )
        return null;
      return {
        id: rule.id,
        revision: rule.revision,
        sourceRef: rule.sourceRef,
        productId: rule.productId,
      };
    },
    async readActivationRule(ruleId: string) {
      if (!z.uuid().safeParse(ruleId).success) return null;
      const row = await prisma.activationRule.findUnique({
        where: { id: ruleId },
      });
      return row?.productId == null
        ? null
        : activationRuleSchema.parse({
            id: row.id,
            code: row.code,
            name: row.name,
            revision: row.revision,
            productId: row.productId,
            sourceRef: row.sourceRef,
            verificationMode: row.verificationMode,
            published: row.published,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt?.toISOString() ?? null,
          });
    },
    readActivationIntent: (attemptId: string) =>
      readActivationIntent(prisma, attemptId, clock()),
    readActivationContinuation: (
      attemptId: string,
      accountId: string,
      identityRef: string | null,
    ) =>
      readActivationContinuation(
        prisma,
        attemptId,
        accountId,
        identityRef,
        clock(),
      ),
    beginActivation: (input: unknown) =>
      beginActivation(prisma, input, clock()),
    activateSubscription: (
      handle: TransactionHandle,
      bindings: Pick<ActivationBindings, "readBinding">,
      linked: Awaited<ReturnType<ActivationBindings["find"]>>,
      input: unknown,
      tier: unknown,
    ) =>
      activateCourse(
        accountRightsTransaction(handle),
        bindings,
        linked,
        input,
        tier,
        clock(),
        (context, command, issuerHandle) =>
          inTransaction(issuerHandle, (tx) =>
            issueProductAccess(tx, accounts, context, command, clock()),
          ),
      ),

    readActivationReceipt: (input: unknown) =>
      readActivationReceipt(prisma, input),
    readOwnEnrollments(targetAccountId: string) {
      return Promise.resolve(
        !z.uuid().safeParse(targetAccountId).success
          ? accessFailure("invalid_input")
          : { ok: true as const, value: [] },
      );
    },
    readContentCatalog: (actorId: string) =>
      manage(actorId, "billing:manage", async () =>
        dependencies.contentCatalog === undefined
          ? accessFailure("unavailable")
          : {
              ok: true as const,
              value: await dependencies.contentCatalog.list(),
            },
      ),
    async countProductHolders(
      handle: TransactionHandle,
      productIds: readonly string[],
    ): Promise<ReadonlyMap<string, number>> {
      const ids = z
        .array(z.uuid())
        .max(100)
        .parse([...new Set(productIds)]);
      const counts = await accountRightsTransaction(
        handle,
      ).productAccess.groupBy({
        by: ["productId"],
        where: { productId: { in: ids }, revokedAt: null },
        _count: { accountId: true },
      });
      return new Map(
        ids.map((id) => [
          id,
          counts.find((row) => row.productId === id.toLowerCase())?._count
            .accountId ?? 0,
        ]),
      );
    },
    listProductAccess: (actorId: string, input: unknown) =>
      manage(actorId, "billing:manage", async () => {
        const query = productAccessListQuerySchema.safeParse(input);
        if (!query.success) return accessFailure("invalid_input");
        const cursor =
          query.data.cursor === undefined
            ? undefined
            : z.tuple([z.uuid(), z.uuid()]).parse(query.data.cursor.split(":"));
        const rows = await prisma.productAccess.findMany({
          where: {
            ...(query.data.accountId === undefined
              ? {}
              : { accountId: query.data.accountId }),
            ...(query.data.productId === undefined
              ? {}
              : { productId: query.data.productId }),
            ...(cursor === undefined
              ? {}
              : {
                  OR: [
                    { accountId: { gt: cursor[0] } },
                    {
                      accountId: cursor[0],
                      productId: { gt: cursor[1] },
                    },
                  ],
                }),
          },
          orderBy: [{ accountId: "asc" }, { productId: "asc" }],
          take: query.data.limit + 1,
        });
        return {
          ok: true as const,
          value: rows.slice(0, query.data.limit).map((row) =>
            productAccessViewSchema.parse({
              accountId: row.accountId,
              productId: row.productId,
              revision: row.revision,
              firstIssuedAt: row.firstIssuedAt.toISOString(),
              access: row.revokedAt === null ? "active" : "revoked",
            }),
          ),
          nextCursor:
            rows.length > query.data.limit
              ? rows[query.data.limit - 1] === undefined
                ? null
                : `${rows[query.data.limit - 1]?.accountId}:${rows[query.data.limit - 1]?.productId}`
              : null,
        };
      }),
    readProductAccess: (actorId: string, input: unknown) =>
      manage(actorId, "billing:manage", async () => {
        const target = productAccessTargetSchema.safeParse(input);
        if (!target.success) return accessFailure("invalid_input");
        return prisma.$transaction(async (tx) => {
          await setAccessSnapshotIsolation(tx);
          const row = await tx.productAccess.findUnique({
            where: { accountId_productId: target.data },
          });
          if (row === null) return accessFailure("not_found");
          const sources = await tx.productAccessSource.findMany({
            where: target.data,
            orderBy: [{ issuedAt: "asc" }, { sourceRef: "asc" }],
            take: 1001,
          });
          const actions = await tx.productAccessAction.findMany({
            where: target.data,
            orderBy: [{ revision: "asc" }, { recordedAt: "asc" }],
            take: 1001,
          });
          if (sources.length > 1000 || actions.length > 1000)
            return accessFailure("unavailable");
          return {
            ok: true as const,
            value: {
              ...productAccessViewSchema.parse({
                accountId: row.accountId,
                productId: row.productId,
                revision: row.revision,
                firstIssuedAt: row.firstIssuedAt.toISOString(),
                access: row.revokedAt === null ? "active" : "revoked",
              }),
              sources: sources.map((source) => ({
                source: source.source,
                sourceRef: source.sourceRef,
                issuedAt: source.issuedAt.toISOString(),
                reason: source.reason,
              })),
              actions: actions.map((action) => ({
                kind: action.kind,
                actorId: action.actorId,
                reason: action.reason,
                recordedAt: action.recordedAt.toISOString(),
                revision: action.revision,
              })),
            },
          };
        });
      }),
    previewProductRevocation: (actorId: string, input: unknown) =>
      manage(actorId, "billing:manage", () =>
        previewProductRevocation(prisma, accounts, input, clock()),
      ),
    revokeProductAccess: (
      actorId: string,
      input: unknown,
      handle?: TransactionHandle,
    ) =>
      inTransaction(handle, (tx) =>
        changeProductAccess(tx, accounts, actorId, input, clock(), "revoke"),
      ),
    restoreProductAccess: (
      actorId: string,
      input: unknown,
      handle?: TransactionHandle,
    ) =>
      inTransaction(handle, (tx) =>
        changeProductAccess(tx, accounts, actorId, input, clock(), "restore"),
      ),
    async readOwnProducts(targetAccountId: string) {
      try {
        return await readOwnProducts(
          prisma,
          targetAccountId,
          clock(),
          dependencies.contentCatalog,
        );
      } catch (error) {
        return dependencyFailure(
          { module: "account-rights", operation: "readOwnProducts" },
          error,
          accessFailure("unavailable"),
        );
      }
    },
    /** Собственные основания Account: без полномочия владельца и без операторских полей. */
    async readOwnAccess(targetAccountId: string) {
      try {
        return await readOwnAccess(
          prisma,
          targetAccountId,
          clock(),
          dependencies.contentCatalog,
        );
      } catch (error) {
        return dependencyFailure(
          { module: "account-rights", operation: "readOwnAccess" },
          error,
          accessFailure("unavailable"),
        );
      }
    },
    async resolveCapabilitiesForAccounts(
      targetAccountIds: readonly string[],
      resource?: { productIds: readonly string[]; materialId?: string },
    ) {
      if (!targetAccountIds.every((id) => z.uuid().safeParse(id).success))
        return accessFailure("invalid_input");
      try {
        const now = clock();
        const uniqueIds = [...new Set(targetAccountIds)];
        const accounts = await prisma.$transaction(async (transaction) => {
          await setAccessSnapshotIsolation(transaction);
          return resolveAccessCapabilitiesForAccounts(
            transaction,
            uniqueIds,
            now,
            resource,
          );
        });
        return { ok: true as const, accounts };
      } catch (error) {
        return dependencyFailure(
          {
            module: "account-rights",
            operation: "resolveCapabilitiesForAccounts",
          },
          error,
          accessFailure("unavailable"),
        );
      }
    },
    /** One Account snapshot, at most 1000 resources, values aligned with input order. */
    async resolveCapabilitiesMany(
      targetAccountId: string,
      resources: readonly {
        productIds: readonly string[];
        materialId?: string;
      }[],
    ) {
      if (
        !z.uuid().safeParse(targetAccountId).success ||
        resources.length > 1000
      )
        return accessFailure("invalid_input");
      try {
        return await prisma.$transaction(async (transaction) => {
          await setAccessSnapshotIsolation(transaction);
          const now = clock();
          const facts = await readAccessCapabilityFacts(
            transaction,
            accountId(targetAccountId),
            now,
          );
          return {
            ok: true as const,
            values: resources.map((resource) =>
              projectAccessCapabilities(facts, now, resource),
            ),
          };
        });
      } catch (error) {
        return dependencyFailure(
          { module: "account-rights", operation: "resolveCapabilitiesMany" },
          error,
          accessFailure("unavailable"),
        );
      }
    },
    async resolveCapabilities(
      targetAccountId: string,
      resource?: { productIds: readonly string[]; materialId?: string },
    ) {
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
              resource,
              { includeRevision: true },
            );
          return { ok: true as const, capabilities, revision, nextBoundary };
        });
      } catch (error) {
        return dependencyFailure(
          {
            module: "account-rights",
            operation: "resolveCapabilities",
          },
          error,
          accessFailure("unavailable"),
        );
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
      } catch (error) {
        return dependencyFailure(
          {
            module: "account-rights",
            operation: "readChangedAccounts",
          },
          error,
          accessFailure("unavailable"),
        );
      }
    },
  });
}
export type AccessGrants = ReturnType<typeof assembleAccessGrants>;
