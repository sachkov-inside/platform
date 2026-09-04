import { createHash } from "node:crypto";

import { z } from "zod";

import { accountId } from "../../../accounts/index.js";
import { lockAccountEntitlementChanges } from "../../../../infrastructure/prisma/index.js";
import type { MembershipEntitlements } from "../../../membership-entitlements/index.js";
import type { WorkshopPrismaClient } from "../../infrastructure/prisma.js";
import type { WorkshopOwnerPolicy } from "../../ports/workshop-owner-policy.js";
import {
  workshopIdempotencyKeySchema,
  workshopScopeSchema,
} from "../../shared/workshop-validation.js";
import type {
  GrantWorkshopEntitlementCommand,
  GrantWorkshopEntitlementResult,
  WorkshopEntitlementDto,
} from "../../facets/workshop/workshop.interface.js";

const commandSchema = z
  .object({
    actorAccountId: z.uuid(),
    targetAccountId: z.uuid(),
    workshopScope: workshopScopeSchema,
    startsAt: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }),
    grantSource: z.literal("owner_beta"),
    idempotencyKey: workshopIdempotencyKeySchema,
  })
  .strict()
  .refine(
    ({ startsAt, validUntil }) =>
      new Date(startsAt).getTime() < new Date(validUntil).getTime(),
    { path: ["validUntil"] },
  );

export async function grantWorkshopEntitlement(
  dependencies: {
    readonly prisma: WorkshopPrismaClient;
    readonly membershipEntitlements: Pick<
      MembershipEntitlements,
      "resolveForAccess"
    >;
    readonly ownerPolicy: WorkshopOwnerPolicy;
    readonly clock: () => Date;
    readonly id: () => string;
  },
  command: GrantWorkshopEntitlementCommand,
): Promise<GrantWorkshopEntitlementResult> {
  const parsed = commandSchema.safeParse(command);
  if (!parsed.success) return failure("invalid_request");
  const fingerprint = requestFingerprint(parsed.data);

  try {
    const allowed = await dependencies.ownerPolicy.canManageWorkshop(
      accountId(parsed.data.actorAccountId),
    );
    if (!allowed) return failure("forbidden");

    try {
      return await dependencies.prisma.$transaction(async (transaction) => {
        await lockAccountEntitlementChanges(
          transaction,
          parsed.data.targetAccountId,
        );
        const replay = await findGrantReplay(
          transaction,
          parsed.data.actorAccountId,
          parsed.data.idempotencyKey,
          fingerprint,
        );
        if (replay !== undefined) return replay;

        const membership = await dependencies.membershipEntitlements.resolveForAccess(
          accountId(parsed.data.targetAccountId),
        );
        if (membership.kind !== "active") return failure("membership_required");

        const created = await transaction.workshopEntitlement.create({
          data: {
            id: dependencies.id(),
            accountId: parsed.data.targetAccountId,
            workshopScope: parsed.data.workshopScope,
            startsAt: new Date(parsed.data.startsAt),
            validUntil: new Date(parsed.data.validUntil),
            grantSource: parsed.data.grantSource,
            grantedBy: parsed.data.actorAccountId,
            idempotencyKey: parsed.data.idempotencyKey,
            requestFingerprint: fingerprint,
            createdAt: dependencies.clock(),
          },
        });
        return { ok: true as const, value: toDto(created) };
      });
    } catch {
      return await findGrantReplay(
        dependencies.prisma,
        parsed.data.actorAccountId,
        parsed.data.idempotencyKey,
        fingerprint,
      ) ?? failure("dependency_unavailable");
    }
  } catch {
    return failure("dependency_unavailable");
  }
}

async function findGrantReplay(
  prisma: Pick<WorkshopPrismaClient, "workshopEntitlement">,
  grantedBy: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<GrantWorkshopEntitlementResult | undefined> {
  const existing = await prisma.workshopEntitlement.findUnique({
    where: {
      grantedBy_idempotencyKey: { grantedBy, idempotencyKey },
    },
  });
  if (existing === null) return undefined;
  return existing.requestFingerprint === fingerprint
    ? { ok: true, value: toDto(existing) }
    : failure("idempotency_key_reused");
}

function requestFingerprint(command: z.infer<typeof commandSchema>): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        grantSource: command.grantSource,
        startsAt: command.startsAt,
        targetAccountId: command.targetAccountId,
        validUntil: command.validUntil,
        workshopScope: command.workshopScope,
      }),
    )
    .digest("hex");
}

function toDto(row: {
  readonly id: string;
  readonly workshopScope: string;
  readonly startsAt: Date;
  readonly validUntil: Date;
}): WorkshopEntitlementDto {
  return {
    entitlementId: row.id,
    workshopScope: row.workshopScope,
    startsAt: row.startsAt.toISOString(),
    validUntil: row.validUntil.toISOString(),
  };
}

function failure(
  code: Extract<GrantWorkshopEntitlementResult, { readonly ok: false }>["error"]["code"],
): Extract<GrantWorkshopEntitlementResult, { readonly ok: false }> {
  return { ok: false, error: { code } };
}
