import { z } from "zod";

import type { TelegramMembershipPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import type { AccessGrants } from "../../../membership-entitlements/index.js";
import {
  sameAccess,
  communityAccessSchema,
  communityResultSchema,
  communityAccessFor,
  accessAllows,
  type DispatchAuthorizeRequest,
} from "../../domain/community-entitlement.js";
import {
  communityDeliveryViewSchema,
  communityMembersWithoutRightSchema,
  type CommunityDeliveryView,
  type CommunityMembersWithoutRight,
  type CommunityOperatorFailureCode,
} from "./community-delivery.contract.js";
import {
  authorizeCommunityDispatch,
  type CommunityAuthorizationOutcome,
} from "../../features/authorize-community-dispatch/authorize-community-dispatch.js";
import {
  deliverCommunityOperations,
  pollCommunityOperations,
  readCommunityBacklog,
  type CommunityBacklog,
} from "../../features/deliver-community-entitlement/deliver-community-entitlement.js";
import {
  projectCommunityEntitlement,
  readLinkChangedAccounts,
} from "../../features/project-community-entitlement/project-community-entitlement.js";
import type { CommunityEntitlementProvider } from "../../ports/community-entitlement-provider.js";
import type { TelegramAccountLinks } from "../telegram-account-links/telegram-account-links.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";

export interface CommunityEntitlementsDependencies {
  readonly prisma: TelegramMembershipPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly grants: Pick<
    AccessGrants,
    "resolveCapabilities" | "readChangedAccounts"
  >;
  readonly links: Pick<TelegramAccountLinks, "readBinding">;
  readonly provider: CommunityEntitlementProvider;
  readonly clock?: () => Date;
}

export interface CommunitySweepReport {
  readonly projected: number;
  readonly failed: number;
  readonly sent: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly polled: number;
  readonly backlog: CommunityBacklog;
}

const OPERATION_HISTORY_LIMIT = 20;
/** Сколько Account с наблюдением просматривает один запрос списка оператора. */
const MEMBERS_WITHOUT_RIGHT_SCAN_LIMIT = 1000;

/**
 * Owns the community half of the Telegram integration: what access the Account should
 * have, what the provider accepted, and what it reports as actually applied. It never
 * grants access and never turns a Telegram observation back into an entitlement.
 */
export class CommunityEntitlements {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: CommunityEntitlementsDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async readOwnAdmission(accountId: string) {
    if (!z.uuid().safeParse(accountId).success) return { admissionRestriction: null, state: "checking" as const };
    const [access, binding, desired] = await Promise.all([
      this.dependencies.grants.resolveCapabilities(accountId), this.dependencies.links.readBinding({ accountId }),
      this.dependencies.prisma.telegramCommunityDesiredState.findUnique({ where: { accountId } }),
    ]);
    if (!access.ok || !binding.ok) return { admissionRestriction: null, state: "checking" as const };
    if (!accessAllows(communityAccessFor(access.capabilities), this.clock())) return { admissionRestriction: null, state: "no_access" as const };
    const operation = desired?.latestOperationId === null || desired?.latestOperationId === undefined ? null
      : await this.dependencies.prisma.telegramCommunityOperation.findUnique({ where: { operationId: desired.latestOperationId } });
    const result = communityResultSchema.safeParse(operation?.result);
    if (!result.success || !sameAccess(result.data.access, communityAccessFor(access.capabilities)) || result.data.admissionRestriction === undefined || binding.binding === null ||
      result.data.binding.linkRevision !== binding.binding.linkRevision || result.data.binding.linkRef !== binding.binding.linkRef ||
      result.data.binding.telegramIdentityRef !== binding.binding.telegramIdentityRef) return { admissionRestriction: null, state: "checking" as const };
    const restriction = result.data.admissionRestriction;
    return { admissionRestriction: restriction, state: restriction === "moderation" ? "moderation_blocked" as const
      : restriction === "none" && (result.data.status === "applied" || result.data.status === "waiting_for_join") ? "ready" as const : "checking" as const };
  }

  /** Recomputes one Account's desired community state and queues what must be sent. */
  project(accountId: string) {
    return projectCommunityEntitlement(
      this.dependencies,
      accountId,
      this.clock(),
    );
  }

  authorizeDispatch(
    input: DispatchAuthorizeRequest,
  ): Promise<CommunityAuthorizationOutcome> {
    return authorizeCommunityDispatch(this.dependencies, input, this.clock());
  }

  /**
   * One background pass: pick up access changes, link changes and reached expiry
   * boundaries, deliver what has no durable acceptance, then reconcile what was accepted.
   */
  async sweep(limit = 50): Promise<CommunitySweepReport> {
    const now = this.clock();
    const { prisma } = this.dependencies;
    const cursor = await prisma.telegramCommunityProjectionCursor.findUnique({
      where: { id: 1 },
    });
    const afterRevision = cursor?.accessRevision ?? 0;
    const changed = await this.dependencies.grants.readChangedAccounts({
      afterRevision,
      limit,
    });
    const accounts = new Set<string>(changed.ok ? changed.accountIds : []);
    const due = await prisma.telegramCommunityDesiredState.findMany({
      where: { nextBoundary: { lte: now } },
      orderBy: { nextBoundary: "asc" },
      take: limit,
      select: { accountId: true },
    });
    for (const row of due) accounts.add(row.accountId);
    for (const accountId of await readLinkChangedAccounts(prisma, limit)) {
      accounts.add(accountId);
    }

    const inWindow = new Set(changed.ok ? changed.accountIds : []);
    let failed = 0;
    let windowFailed = false;
    for (const accountId of accounts) {
      const projection = await projectCommunityEntitlement(
        this.dependencies,
        accountId,
        now,
      );
      if (projection.ok) continue;
      failed += 1;
      // Only a failure inside the cursor's own window may hold the cursor back;
      // an unrelated boundary or link Account must not stall the audit trail.
      if (inWindow.has(accountId)) windowFailed = true;
    }
    if (changed.ok && !windowFailed && changed.cursor > afterRevision) {
      await prisma.telegramCommunityProjectionCursor.upsert({
        where: { id: 1 },
        create: { id: 1, accessRevision: changed.cursor, updatedAt: now },
        update: { accessRevision: changed.cursor, updatedAt: now },
      });
    }

    const delivery = await deliverCommunityOperations(
      this.dependencies,
      limit,
      now,
    );
    const polled = await pollCommunityOperations(this.dependencies, limit, now);
    return {
      accepted: delivery.accepted,
      backlog: await readCommunityBacklog(prisma, now),
      failed,
      polled,
      projected: accounts.size,
      rejected: delivery.rejected,
      sent: delivery.sent,
    };
  }

  /** Operator view: desired, accepted and applied are separate facts here. */
  async readDelivery(
    actorId: string,
    accountId: string,
  ): Promise<
    | { readonly ok: true; readonly value: CommunityDeliveryView }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: CommunityOperatorFailureCode;
        };
      }
  > {
    if (
      !z.uuid().safeParse(accountId).success ||
      !z.uuid().safeParse(actorId).success
    ) {
      return { ok: false, error: { code: "invalid_input" } };
    }
    try {
      const permission = await this.dependencies.accounts.checkPermission({
        accountId: actorId,
        permission: "platform:admin",
      });
      if (!permission.ok) return { ok: false, error: { code: "unavailable" } };
      if (!permission.allowed) {
        return { ok: false, error: { code: "forbidden" } };
      }
      const { prisma } = this.dependencies;
      const [state, operations] = await Promise.all([
        prisma.telegramCommunityDesiredState.findUnique({
          where: { accountId },
        }),
        prisma.telegramCommunityOperation.findMany({
          where: { accountId },
          orderBy: { entitlementRevision: "desc" },
          take: OPERATION_HISTORY_LIMIT,
        }),
      ]);
      return {
        ok: true,
        value: communityDeliveryViewSchema.parse({
          desired:
            state === null
              ? null
              : {
                  access: communityAccessSchema.parse(state.access),
                  entitlementRevision: state.entitlementRevision,
                  nextBoundary: state.nextBoundary?.toISOString() ?? null,
                  projectedAt: state.projectedAt.toISOString(),
                  telegramIdentityRef: state.identityRef,
                },
          operations: operations.map((row) => ({
            access: communityAccessSchema.parse(row.access),
            appliedState: row.resultStatus,
            delivery: row.delivery,
            entitlementRevision: row.entitlementRevision,
            errorCode: row.errorCode,
            issuedAt: row.issuedAt.toISOString(),
            observedMembership: row.observedMembership,
            operationId: row.operationId,
            purpose: row.purpose,
            updatedAt: row.updatedAt.toISOString(),
          })),
        }),
      };
    } catch (error) {
      return dependencyFailure({ module: "telegram-membership", operation: "readDelivery" }, error, { ok: false, error: { code: "unavailable" } });
    }
  }

  /**
   * Список оператора, пока удаления из чата выключены: Account, которых последнее наблюдение
   * Telegram всё ещё видит в чате, хотя ни одно действующее право чат не открывает. Platform видит
   * только привязанные Account, для которых она строила желаемое состояние; участники без
   * привязки остаются на стороне Telegram. Список ничего не меняет: убирает человека оператор.
   */
  async listMembersWithoutRight(actorId: string): Promise<
    | { readonly ok: true; readonly value: CommunityMembersWithoutRight }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: CommunityOperatorFailureCode;
        };
      }
  > {
    if (!z.uuid().safeParse(actorId).success) {
      return { ok: false, error: { code: "invalid_input" } };
    }
    try {
      const permission = await this.dependencies.accounts.checkPermission({
        accountId: actorId,
        permission: "platform:admin",
      });
      if (!permission.ok) return { ok: false, error: { code: "unavailable" } };
      if (!permission.allowed) {
        return { ok: false, error: { code: "forbidden" } };
      }
      const now = this.clock();
      // Последнее известное наблюдение каждого Account: более новая операция без результата
      // ещё ничего не сообщила о присутствии в чате.
      const observations = await this.dependencies.prisma.telegramCommunityOperation.findMany({
        where: { observedMembership: { not: null } },
        orderBy: [{ accountId: "asc" }, { entitlementRevision: "desc" }],
        distinct: ["accountId"],
        take: MEMBERS_WITHOUT_RIGHT_SCAN_LIMIT + 1,
        select: {
          accountId: true,
          identityRef: true,
          observedMembership: true,
          resultAt: true,
          updatedAt: true,
        },
      });
      const items = [];
      for (const row of observations.slice(0, MEMBERS_WITHOUT_RIGHT_SCAN_LIMIT)) {
        if (row.observedMembership !== "member") continue;
        const access = await this.dependencies.grants.resolveCapabilities(row.accountId);
        if (!access.ok) return { ok: false, error: { code: "unavailable" } };
        if (accessAllows(communityAccessFor(access.capabilities), now)) continue;
        items.push({
          accountId: row.accountId,
          telegramIdentityRef: row.identityRef,
          observedAt: (row.resultAt ?? row.updatedAt).toISOString(),
        });
      }
      return {
        ok: true,
        value: communityMembersWithoutRightSchema.parse({
          checkedAt: now.toISOString(),
          items,
          truncated: observations.length > MEMBERS_WITHOUT_RIGHT_SCAN_LIMIT,
        }),
      };
    } catch (error) {
      return dependencyFailure({ module: "telegram-membership", operation: "listMembersWithoutRight" }, error, { ok: false, error: { code: "unavailable" } });
    }
  }
}
