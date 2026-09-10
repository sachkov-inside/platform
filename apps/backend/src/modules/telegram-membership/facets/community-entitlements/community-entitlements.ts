import { z } from "zod";

import type { TelegramMembershipPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import type { AccessGrants } from "../../../membership-entitlements/index.js";
import {
  communityAccessSchema,
  type DispatchAuthorizeRequest,
} from "../../domain/community-entitlement.js";
import {
  communityDeliveryViewSchema,
  type CommunityDeliveryView,
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

    let failed = 0;
    for (const accountId of accounts) {
      const projection = await projectCommunityEntitlement(
        this.dependencies,
        accountId,
        now,
      );
      if (!projection.ok) failed += 1;
    }
    // The audit cursor only advances over a fully projected window.
    if (changed.ok && failed === 0 && changed.cursor > afterRevision) {
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
          readonly code: "invalid_input" | "forbidden" | "unavailable";
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
    } catch {
      return { ok: false, error: { code: "unavailable" } };
    }
  }
}
