import { createHash } from "node:crypto";

import { z } from "zod";

import {
  lockAccountEntitlementChanges,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import type {
  MembershipEntitlementsPrismaClient,
  MembershipEntitlementsPrismaTransaction,
} from "../../infrastructure/prisma.js";
import {
  isObservedMembershipEvidence,
  validateMembershipEvidence,
  type MembershipEvidence,
  type ObservedMembershipEvidence,
} from "./validate-membership-evidence.js";
import type {
  AcceptMembershipEvidenceCommand,
  MembershipEvidenceAcceptance,
  MembershipEvidenceFailureCode,
} from "../../facets/membership-entitlements/membership-entitlements.interface.js";
import type { WorkshopEntitlements } from "../../../workshop/index.js";

const EVIDENCE_RECEIPT_RETENTION_DAYS = 30;

const commandMetadataSchema = z
  .object({
    deliveryId: z
      .string()
      .min(1)
      .max(256)
      .brand<"MembershipEvidenceDeliveryId">(),
    source: z.enum([
      "link_time",
      "member_status_event",
      "reconciliation",
    ]),
  })
  .strict();

type CheckedEvidenceCommand = Omit<
  AcceptMembershipEvidenceCommand,
  "deliveryId" | "source"
> &
  z.infer<typeof commandMetadataSchema>;
type EvidenceDeliveryId = CheckedEvidenceCommand["deliveryId"];
type AccountBindingState = "matches" | "missing" | "mismatch";

const bindingRowsSchema = z.array(
  z
    .object({
      account_id: z.uuid(),
      principal_ref: z.string().min(1).max(256),
    })
    .strict(),
);
const receiptDecisionSchema = z.enum([
  "member",
  "not_member",
  "identity_not_linked",
  "identity_conflict",
  "unavailable",
]);
const receiptOutcomeSchema = z.enum([
  "processing",
  "awaiting_binding",
  "applied",
  "accepted_without_entitlement",
  "duplicate",
  "unsupported_contract",
  "invalid_evidence",
  "principal_mismatch",
  "expired_evidence",
  "replayed_evidence",
]);
const lockedReceiptRowsSchema = z.tuple([
  z
    .object({
      requestFingerprint: z.string().length(64),
      outcome: receiptOutcomeSchema,
      decision: receiptDecisionSchema.nullable(),
      evidenceVersion: z.bigint().nullable(),
    })
    .strict(),
]);
type LockedReceipt = z.infer<typeof lockedReceiptRowsSchema>[0];

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
  workshopEntitlements: Pick<
    WorkshopEntitlements,
    "applyAcceptedMembershipEvidence"
  >,
  command: AcceptMembershipEvidenceCommand,
  now: Date,
): Promise<MembershipEvidenceAcceptance> {
  const metadata = commandMetadataSchema.safeParse({
    deliveryId: command.deliveryId,
    source: command.source,
  });
  if (!metadata.success) {
    return failure("invalid_evidence");
  }
  const checkedCommand: CheckedEvidenceCommand = {
    ...command,
    ...metadata.data,
  };
  const validation = validateMembershipEvidence(command.evidence, now);
  const requestFingerprint = fingerprint({
    accountId: command.accountId,
    source: checkedCommand.source,
    evidence: command.evidence,
  });
  const evidenceFingerprint = fingerprint(
    validation.ok ? validation.value : command.evidence,
  );
  const retainUntil = addDays(now, EVIDENCE_RECEIPT_RETENTION_DAYS);

  return prisma.$transaction(async (transaction) => {
    await lockAccountEntitlementChanges(transaction, command.accountId);
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
        ${checkedCommand.deliveryId},
        ${command.accountId}::uuid,
        ${checkedCommand.source},
        ${requestFingerprint},
        'processing',
        ${now},
        ${retainUntil}
      )
      on conflict do nothing
    `);
    const [receipt] = lockedReceiptRowsSchema.parse(
      await transaction.$queryRaw(Prisma.sql`
        select
          request_fingerprint as "requestFingerprint",
          outcome,
          decision,
          evidence_version as "evidenceVersion"
        from membership_entitlements.evidence_receipts
        where delivery_id = ${checkedCommand.deliveryId}
        for update
      `),
    );
    if (inserted === 0) {
      const existing = existingReceiptResult(receipt, requestFingerprint);
      if (existing !== "retry") {
        return existing;
      }
    }

    if (!validation.ok) {
      return finishFailure(
        transaction,
        checkedCommand.deliveryId,
        validation.error.code,
      );
    }

    await transaction.membershipEvidenceReceipt.update({
      where: { deliveryId: checkedCommand.deliveryId },
      data: evidenceReceiptMetadata(validation.value),
    });

    const bindingState = await checkAccountBinding(
      transaction,
      checkedCommand,
      validation.value,
      now,
    );
    if (bindingState === "mismatch") {
      return finishFailure(
        transaction,
        checkedCommand.deliveryId,
        "principal_mismatch",
      );
    }
    if (
      bindingState === "missing" &&
      checkedCommand.source !== "link_time"
    ) {
      return awaitAccountBinding(transaction, checkedCommand.deliveryId);
    }

    if (!isObservedMembershipEvidence(validation.value)) {
      const result = {
        ok: true,
        outcome: "accepted_without_entitlement",
        decision: validation.value.decision,
      } as const;
      await transaction.membershipEvidenceReceipt.update({
        where: { deliveryId: checkedCommand.deliveryId },
        data: { outcome: result.outcome },
      });
      return result;
    }
    if (bindingState === "missing") {
      return awaitAccountBinding(transaction, checkedCommand.deliveryId);
    }

    const applied = await applyObservedEvidence(
      transaction,
      workshopEntitlements,
      checkedCommand,
      validation.value,
      evidenceFingerprint,
      now,
    );
    if (!applied.ok) {
      return finishFailure(
        transaction,
        checkedCommand.deliveryId,
        applied.error.code,
      );
    }
    await transaction.membershipEvidenceReceipt.update({
      where: { deliveryId: checkedCommand.deliveryId },
      data: { outcome: applied.outcome },
    });
    return applied;
  });
}

async function checkAccountBinding(
  transaction: MembershipEntitlementsPrismaTransaction,
  command: CheckedEvidenceCommand,
  evidence: MembershipEvidence,
  now: Date,
): Promise<AccountBindingState> {
  if (command.source === "link_time" && isObservedMembershipEvidence(evidence)) {
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
  if (bindings.length === 0) {
    return "missing";
  }
  return (
    bindings.length === 1 &&
    bindings[0]?.account_id === command.accountId &&
    bindings[0].principal_ref === evidence.principalRef
  )
    ? "matches"
    : "mismatch";
}

async function applyObservedEvidence(
  transaction: MembershipEntitlementsPrismaTransaction,
  workshopEntitlements: Pick<
    WorkshopEntitlements,
    "applyAcceptedMembershipEvidence"
  >,
  command: CheckedEvidenceCommand,
  evidence: ObservedMembershipEvidence,
  evidenceFingerprint: string,
  now: Date,
): Promise<ObservedEvidenceApplication> {
  const projection = projectionData(evidence, evidenceFingerprint, now);
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
      ${projection.principalRef},
      ${projection.decision},
      ${projection.evidenceRef},
      ${projection.evidenceVersion},
      ${projection.evidenceFingerprint},
      ${projection.checkedAt},
      ${projection.validUntil},
      ${projection.updatedAt}
    )
    on conflict do nothing
  `);
  if (inserted === 1) {
    await applyWorkshopEvidence(
      workshopEntitlements,
      transaction,
      command,
      evidence,
      evidenceFingerprint,
      now,
    );
    return appliedResult(evidence);
  }

  const updated = await transaction.membershipProjection.updateMany({
    where: {
      accountId: command.accountId,
      evidenceVersion: { lt: BigInt(evidence.evidenceVersion) },
    },
    data: projection,
  });
  if (updated.count === 1) {
    await applyWorkshopEvidence(
      workshopEntitlements,
      transaction,
      command,
      evidence,
      evidenceFingerprint,
      now,
    );
    return appliedResult(evidence);
  }

  const current = await transaction.membershipProjection.findUnique({
    where: { accountId: command.accountId },
  });
  if (current === null) {
    throw new Error("Membership projection conflict without an Account row");
  }
  if (current.evidenceVersion === BigInt(evidence.evidenceVersion)) {
    if (current.evidenceFingerprint !== evidenceFingerprint) {
      return failure("replayed_evidence");
    }
    await applyWorkshopEvidence(
      workshopEntitlements,
      transaction,
      command,
      evidence,
      evidenceFingerprint,
      now,
    );
    return {
      ok: true,
      outcome: "duplicate",
      evidenceVersion: evidence.evidenceVersion,
    };
  }
  return failure("replayed_evidence");
}

function applyWorkshopEvidence(
  workshopEntitlements: Pick<
    WorkshopEntitlements,
    "applyAcceptedMembershipEvidence"
  >,
  transaction: MembershipEntitlementsPrismaTransaction,
  command: CheckedEvidenceCommand,
  evidence: ObservedMembershipEvidence,
  evidenceFingerprint: string,
  now: Date,
): Promise<void> {
  return workshopEntitlements.applyAcceptedMembershipEvidence(transaction, {
    accountId: command.accountId,
    principalRef: evidence.principalRef,
    decision: evidence.decision,
    evidenceRef: evidence.evidenceRef,
    evidenceVersion: evidence.evidenceVersion,
    evidenceFingerprint,
    checkedAt: new Date(evidence.checkedAt),
    validUntil: new Date(evidence.validUntil),
    acceptedAt: now,
  });
}

function projectionData(
  evidence: ObservedMembershipEvidence,
  evidenceFingerprint: string,
  now: Date,
) {
  return {
    principalRef: evidence.principalRef,
    decision: evidence.decision,
    evidenceRef: evidence.evidenceRef,
    evidenceVersion: BigInt(evidence.evidenceVersion),
    evidenceFingerprint,
    checkedAt: new Date(evidence.checkedAt),
    validUntil: new Date(evidence.validUntil),
    updatedAt: now,
  };
}

function evidenceReceiptMetadata(evidence: MembershipEvidence) {
  if (isObservedMembershipEvidence(evidence)) {
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
  deliveryId: EvidenceDeliveryId,
  code: Exclude<MembershipEvidenceFailureCode, "unavailable">,
): Promise<MembershipEvidenceAcceptance> {
  await transaction.membershipEvidenceReceipt.update({
    where: { deliveryId },
    data: { outcome: code },
  });
  return failure(code);
}

async function awaitAccountBinding(
  transaction: MembershipEntitlementsPrismaTransaction,
  deliveryId: EvidenceDeliveryId,
): Promise<MembershipEvidenceAcceptance> {
  await transaction.membershipEvidenceReceipt.update({
    where: { deliveryId },
    data: { outcome: "awaiting_binding" },
  });
  return { ok: false, error: { code: "unavailable" } };
}

function existingReceiptResult(
  receipt: LockedReceipt,
  requestFingerprint: string,
): MembershipEvidenceAcceptance | "retry" {
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
    case "awaiting_binding":
      return "retry";
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
