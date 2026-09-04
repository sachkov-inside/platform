import { z } from "zod";

import { Prisma } from "../../../../infrastructure/prisma/index.js";
import type {
  AcceptedMembershipEvidence,
  WorkshopEntitlementTransaction,
} from "../../facets/workshop-entitlements/workshop-entitlements.interface.js";

const evidenceSchema = z
  .object({
    accountId: z.uuid(),
    principalRef: z.string().min(1).max(256),
    decision: z.enum(["member", "not_member"]),
    evidenceRef: z.string().min(1).max(256),
    evidenceVersion: z.number().int().positive(),
    evidenceFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    checkedAt: z.date(),
    validUntil: z.date(),
    acceptedAt: z.date(),
  })
  .strict()
  .refine(
    ({ checkedAt, validUntil }) => checkedAt.getTime() < validUntil.getTime(),
    { path: ["validUntil"] },
  );

const currentProjectionSchema = z
  .object({
    evidenceVersion: z.bigint().positive(),
    evidenceFingerprint: z.string().length(64),
  })
  .strict();

export async function applyAcceptedMembershipEvidence(
  transaction: WorkshopEntitlementTransaction,
  evidence: AcceptedMembershipEvidence,
): Promise<void> {
  const checked = evidenceSchema.parse(evidence);
  const inserted = await transaction.$executeRaw(Prisma.sql`
    insert into workshop.membership_entitlement_projections (
      account_id,
      principal_ref,
      decision,
      evidence_ref,
      evidence_version,
      evidence_fingerprint,
      checked_at,
      valid_until,
      updated_at
    ) values (
      ${checked.accountId}::uuid,
      ${checked.principalRef},
      ${checked.decision},
      ${checked.evidenceRef},
      ${checked.evidenceVersion},
      ${checked.evidenceFingerprint},
      ${checked.checkedAt},
      ${checked.validUntil},
      ${checked.acceptedAt}
    )
    on conflict do nothing
  `);
  if (inserted === 1) return;

  const changed = await transaction.$executeRaw(Prisma.sql`
    update workshop.membership_entitlement_projections
    set
      principal_ref = ${checked.principalRef},
      decision = ${checked.decision},
      evidence_ref = ${checked.evidenceRef},
      evidence_version = ${checked.evidenceVersion},
      evidence_fingerprint = ${checked.evidenceFingerprint},
      checked_at = ${checked.checkedAt},
      valid_until = ${checked.validUntil},
      updated_at = ${checked.acceptedAt}
    where account_id = ${checked.accountId}::uuid
      and evidence_version < ${checked.evidenceVersion}
  `);
  if (changed === 1) return;

  const rows = z.array(currentProjectionSchema).length(1).parse(
    await transaction.$queryRaw(Prisma.sql`
      select
        evidence_version as "evidenceVersion",
        evidence_fingerprint as "evidenceFingerprint"
      from workshop.membership_entitlement_projections
      where account_id = ${checked.accountId}::uuid
    `),
  );
  const current = rows[0];
  if (
    current !== undefined &&
    current.evidenceVersion === BigInt(checked.evidenceVersion) &&
    current.evidenceFingerprint === checked.evidenceFingerprint
  ) {
    return;
  }
  throw new Error("Workshop entitlement projection diverged from Membership evidence");
}
