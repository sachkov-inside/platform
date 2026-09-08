import { setAccessSnapshotIsolation } from "../../infrastructure/access-lock.js";
import { z } from "zod";
import { accountId, type Accounts } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import {
  accessFailure,
  classificationSchema,
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

export interface AccessGrantsDependencies {
  readonly prisma: MembershipEntitlementsPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission" | "readIdentityForLink">;
  readonly clock?: () => Date;
}
// Internal capability for billing fulfillment, owner operations (#409), and community projection (#415).
// Actor comes from the delegated adapter, outside the command payload.
export function assembleAccessGrants(dependencies: AccessGrantsDependencies) {
  const { prisma, accounts } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  async function manage<Result>(
    actorId: string,
    operation: () => Promise<Result>,
  ) {
    try {
      if (!z.uuid().safeParse(actorId).success)
        return accessFailure("invalid_input");
      const permission = await accounts.checkPermission({
        accountId: actorId,
        permission: "platform:admin",
      });
      if (!permission.ok) return accessFailure("unavailable");
      if (!permission.allowed) return accessFailure("forbidden");
      return await operation();
    } catch {
      return accessFailure("unavailable");
    }
  }
  return Object.freeze({
    async applyPaidPeriod(command: ApplyPaidPeriodCommand) {
      try {
        return await applyPaidPeriod(prisma, accounts, command, clock());
      } catch {
        return accessFailure("unavailable");
      }
    },
    previewBatch: (actorId: string, command: PreviewGrantBatchCommand) =>
      manage(actorId, () =>
        previewGrantBatch(prisma, accounts, actorId, command, clock()),
      ),
    applyBatch: (actorId: string, command: ApplyGrantBatchCommand) =>
      manage(actorId, () =>
        applyGrantBatch(prisma, accounts, actorId, command, clock()),
      ),
    changeGrant: (actorId: string, command: ChangeAccessGrantCommand) =>
      manage(actorId, () =>
        changeAccessGrant(prisma, actorId, command, clock()),
      ),
    classifyLegacy: (actorId: string, command: ClassifyLegacyAccountCommand) =>
      manage(actorId, () =>
        classifyLegacyAccount(prisma, accounts, actorId, command, clock()),
      ),
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
    async readLegacyClassification(targetAccountId: string) {
      if (!z.uuid().safeParse(targetAccountId).success)
        return accessFailure("invalid_input");
      try {
        const row = await prisma.legacyClassification.findUnique({
          where: { accountId: targetAccountId },
        });
        const classification = classificationSchema.parse(
          row?.classification ?? "unknown",
        );
        return {
          ok: true as const,
          classification,
          revision: row?.revision ?? 0,
          recurringAllowed:
            classification === "confirmed_new" ||
            (classification === "confirmed_legacy" &&
              row?.tributeStopped === true),
        };
      } catch {
        return accessFailure("unavailable");
      }
    },
  });
}
export type AccessGrants = ReturnType<typeof assembleAccessGrants>;
