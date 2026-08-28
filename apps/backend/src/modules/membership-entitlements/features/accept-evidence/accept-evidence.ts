import { createHash } from "node:crypto";

import { z } from "zod";

import { Prisma } from "../../../../infrastructure/prisma/index.js";
import type {
  MembershipEntitlementsPrismaClient,
  MembershipEntitlementsPrismaTransaction,
} from "../../infrastructure/prisma.js";
import {
  validateMembershipEvidence,
  type MembershipEvidence,
  type ObservedMembershipEvidence,
} from "../../domain/membership-evidence.js";
import type {
  AcceptMembershipEvidenceCommand,
  MembershipEvidenceAcceptance,
  MembershipEvidenceFailureCode,
} from "../../facets/membership-entitlements/membership-entitlements.interface.js";

const EVIDENCE_RECEIPT_RETENTION_DAYS = 30;

const bindingRowsSchema = z.array(
  z
    .object({
      account_id: z.uuid(),
      principal_ref: z.string().min(1).max(256),
    })
    .strict(),
);

type AppliedEvidence = Extract<
  MembershipEvidenceAcceptance,
  { readonly ok: true; readonly outcome: "applied" }
>;
type DuplicateEvidence = Extract<
  MembershipEvidenceAcceptance,
  { readonly ok: true; readonly outcome: "duplicate" }
>;
type ObservedEvidenceApplication =
  | AppliedEvidence
  | DuplicateEvidence
  | Readonly<{
      ok: false;
      error: { readonly code: "replayed_evidence" };
    }>;

export async function acceptMembershipEvidence(
  prisma: MembershipEntitlementsPrismaClient,
  command: AcceptMembershipEvidenceCommand,
  now: Date,
): Promise<MembershipEvidenceAcceptance> {
  const validation = validateMembershipEvidence(command.evidence, now);
  const requestFingerprint = fingerprint({
    accountId: command.accountId,
    source: command.source,
    evidence: command.evidence,
  });
  const evidenceFingerprint = fingerprint(
    validation.ok ? validation.value : command.evidence,
  );
  const retainUntil = addDays(now, EVIDENCE_RECEIPT_RETENTION_DAYS);

  return prisma.$transaction(async (transaction) => {
    const inserted = await transaction.$executeRaw(Prisma.sql`
      insert into membership_entitlements.evidence_receipts (
        delivery_id,
        account_id,
        source,
        request_fingerprint,
        outcome,
        received_at,
        retain_until
      ) values (
        ${command.deliveryId},
        ${command.accountId}::uuid,
        ${command.source},
        ${requestFingerprint},
        'processing',
        ${now},
        ${retainUntil}
      )
      on conflict do nothing
    `);
    const receipt = await transaction.membershipEvidenceReceipt.findUnique({
      where: { deliveryId: command.deliveryId },
    });
    if (receipt === null) {
      throw new Error("Evidence receipt disappeared inside its transaction");
    }
    if (inserted === 0) {
      return existingReceiptResult(receipt, requestFingerprint);
    }

    if (!validation.ok) {
      return finishFailure(
        transaction,
        command.deliveryId,
        validation.error.code,
      );
    }

    await transaction.membershipEvidenceReceipt.update({
      where: { deliveryId: command.deliveryId },
      data: evidenceReceiptMetadata(validation.value),
    });

    if (
      validation.value.decision !== "member" &&
      validation.value.decision !== "not_member"
    ) {
      const result = {
        ok: true,
        outcome: "accepted_without_entitlement",
        decision: validation.value.decision,
      } as const;
      await transaction.membershipEvidenceReceipt.update({
        where: { deliveryId: command.deliveryId },
        data: { outcome: result.outcome },
      });
      return result;
    }

    const bindingMatches = await requireAccountBinding(
      transaction,
      command,
      validation.value,
      now,
    );
    if (!bindingMatches) {
      return finishFailure(
        transaction,
        command.deliveryId,
        "principal_mismatch",
      );
    }

    const applied = await applyObservedEvidence(
      transaction,
      command,
      validation.value,
      evidenceFingerprint,
      now,
    );
    if (!applied.ok) {
      return finishFailure(
        transaction,
        command.deliveryId,
        applied.error.code,
      );
    }
    await transaction.membershipEvidenceReceipt.update({
      where: { deliveryId: command.deliveryId },
      data: { outcome: applied.outcome },
    });
    return applied;
  });
}

async function requireAccountBinding(
  transaction: MembershipEntitlementsPrismaTransaction,
  command: AcceptMembershipEvidenceCommand,
  evidence: ObservedMembershipEvidence,
  now: Date,
): Promise<boolean> {
  if (command.source === "link_time") {
    await transaction.$executeRaw(Prisma.sql`
      insert into membership_entitlements.account_bindings (
        account_id,
        principal_ref,
        linked_at
      ) values (${command.accountId}::uuid, ${evidence.principalRef}, ${now})
      on conflict do nothing
    `);
  }
  const bindings = bindingRowsSchema.parse(
    await transaction.$queryRaw(Prisma.sql`
      select account_id::text, principal_ref
      from membership_entitlements.account_bindings
      where account_id = ${command.accountId}::uuid
         or principal_ref = ${evidence.principalRef}
      order by account_id
      for update
    `),
  );
  return (
    bindings.length === 1 &&
    bindings[0]?.account_id === command.accountId &&
    bindings[0].principal_ref === evidence.principalRef
  );
}

async function applyObservedEvidence(
  transaction: MembershipEntitlementsPrismaTransaction,
  command: AcceptMembershipEvidenceCommand,
  evidence: ObservedMembershipEvidence,
  evidenceFingerprint: string,
  now: Date,
): Promise<ObservedEvidenceApplication> {
  const inserted = await transaction.$executeRaw(Prisma.sql`
    insert into membership_entitlements.current_projections (
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
      ${command.accountId}::uuid,
      ${evidence.principalRef},
      ${evidence.decision},
      ${evidence.evidenceRef},
      ${BigInt(evidence.evidenceVersion)},
      ${evidenceFingerprint},
      ${new Date(evidence.checkedAt)},
      ${new Date(evidence.validUntil)},
      ${now}
    )
    on conflict do nothing
  `);
  if (inserted === 1) {
    return appliedResult(evidence);
  }

  const updated = await transaction.membershipProjection.updateMany({
    where: {
      accountId: command.accountId,
      evidenceVersion: { lt: BigInt(evidence.evidenceVersion) },
    },
    data: {
      principalRef: evidence.principalRef,
      decision: evidence.decision,
      evidenceRef: evidence.evidenceRef,
      evidenceVersion: BigInt(evidence.evidenceVersion),
      evidenceFingerprint,
      checkedAt: new Date(evidence.checkedAt),
      validUntil: new Date(evidence.validUntil),
      updatedAt: now,
    },
  });
  if (updated.count === 1) {
    return appliedResult(evidence);
  }

  const current = await transaction.membershipProjection.findUnique({
    where: { accountId: command.accountId },
  });
  if (current === null) {
    throw new Error("Membership projection conflict without an Account row");
  }
  if (current.evidenceVersion === BigInt(evidence.evidenceVersion)) {
    return current.evidenceFingerprint === evidenceFingerprint
      ? {
          ok: true,
          outcome: "duplicate",
          evidenceVersion: evidence.evidenceVersion,
        }
      : failure("replayed_evidence");
  }
  return failure("replayed_evidence");
}

function evidenceReceiptMetadata(evidence: MembershipEvidence) {
  if (evidence.decision === "member" || evidence.decision === "not_member") {
    return {
      principalRef: evidence.principalRef,
      evidenceRef: evidence.evidenceRef,
      evidenceVersion: BigInt(evidence.evidenceVersion),
      decision: evidence.decision,
      checkedAt: new Date(evidence.checkedAt),
      validUntil: new Date(evidence.validUntil),
    };
  }
  return {
    principalRef: evidence.principalRef,
    decision: evidence.decision,
  };
}

function appliedResult(
  evidence: ObservedMembershipEvidence,
): AppliedEvidence {
  return {
    ok: true,
    outcome: "applied",
    state: evidence.decision === "member" ? "active" : "non_member",
    evidenceVersion: evidence.evidenceVersion,
  };
}

async function finishFailure(
  transaction: MembershipEntitlementsPrismaTransaction,
  deliveryId: string,
  code: Exclude<MembershipEvidenceFailureCode, "unavailable">,
): Promise<MembershipEvidenceAcceptance> {
  await transaction.membershipEvidenceReceipt.update({
    where: { deliveryId },
    data: { outcome: code },
  });
  return failure(code);
}

function existingReceiptResult(
  receipt: {
    readonly requestFingerprint: string;
    readonly outcome: string;
    readonly decision: string | null;
    readonly evidenceVersion: bigint | null;
  },
  requestFingerprint: string,
): MembershipEvidenceAcceptance {
  if (receipt.requestFingerprint !== requestFingerprint) {
    return failure("invalid_evidence");
  }
  switch (receipt.outcome) {
    case "applied":
      if (
        receipt.evidenceVersion === null ||
        (receipt.decision !== "member" && receipt.decision !== "not_member")
      ) {
        break;
      }
      return {
        ok: true,
        outcome: "applied",
        state: receipt.decision === "member" ? "active" : "non_member",
        evidenceVersion: Number(receipt.evidenceVersion),
      };
    case "accepted_without_entitlement":
      if (
        receipt.decision === "identity_not_linked" ||
        receipt.decision === "identity_conflict" ||
        receipt.decision === "unavailable"
      ) {
        return {
          ok: true,
          outcome: "accepted_without_entitlement",
          decision: receipt.decision,
        };
      }
      break;
    case "duplicate":
      if (receipt.evidenceVersion !== null) {
        return {
          ok: true,
          outcome: "duplicate",
          evidenceVersion: Number(receipt.evidenceVersion),
        };
      }
      break;
    case "unsupported_contract":
    case "invalid_evidence":
    case "principal_mismatch":
    case "expired_evidence":
    case "replayed_evidence":
      return failure(receipt.outcome);
    case "processing":
      break;
  }
  throw new Error("Invalid terminal Membership evidence receipt");
}

function failure<
  Code extends Exclude<MembershipEvidenceFailureCode, "unavailable">,
>(code: Code): Readonly<{ ok: false; error: { readonly code: Code } }> {
  return { ok: false, error: { code } };
}

function fingerprint(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "undefined";
  } catch {
    serialized = Object.prototype.toString.call(value);
  }
  return createHash("sha256").update(serialized).digest("hex");
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
