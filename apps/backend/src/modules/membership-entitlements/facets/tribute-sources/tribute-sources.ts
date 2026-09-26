import {
  tributeImportReviewSchema,
  dismissTributeImportSchema,
} from "../../domain/tribute-source.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { RecipientLinks } from "../../ports/recipient-links.js";
import {
  Prisma,
  lockTelegramAccountBinding,
  lockAccountEntitlementChanges,
  lockAccountAccess,
} from "../../../../infrastructure/prisma/index.js";
import type {
  MembershipEntitlementsPrismaClient,
  MembershipEntitlementsPrisma,
} from "../../infrastructure/prisma.js";
import {
  accessFingerprint,
  readAccessReceipt,
} from "../../shared/access-receipts.js";
import { sourceIdentityRef } from "../../domain/source-identity.js";
import {
  tierSnapshotSchema,
  type TierSnapshot,
} from "../../domain/subscription-enrollment.js";
import { accessFailure } from "../../domain/access-grant.js";
import {
  applyTributeImportSchema,
  previewTributeImportSchema,
  saveTributePolicySchema,
  tributePolicySchema,
  tributePreviewSchema,
  tributeApplyResultSchema,
  tributeStateSchema,
  type TributeImportRow,
  type TributeState,
  tributePreviewRowSchema,
  tributeOperationsViewSchema,
  reconcileTributeSchema,
  retryTributeInboxSchema,
  tributeInboxViewSchema,
  tributeSourceViewSchema,
} from "../../domain/tribute-source.js";
import {
  tributeInboxView,
  receiveTribute,
  reconcileTributeEvent,
} from "../../features/receive-tribute/receive-tribute.js";
import { changeEnrollmentInTransaction } from "../../features/change-enrollment/change-enrollment.js";
import {
  projectTributeSource,
  tributeSourceView,
} from "../../shared/tribute-source.js";

const importPreviewLifetimeMilliseconds = 10 * 60 * 1_000;
const sourceConfirmationFreshnessMilliseconds = 24 * 60 * 60 * 1_000;
const reconciliationIntervalMilliseconds = 60 * 1_000;

interface Dependencies {
  prisma: MembershipEntitlementsPrismaClient;
  accounts: Pick<Accounts, "checkPermission">;
  links: RecipientLinks;
  clock?: () => Date;
}
const storedPreviewSchema = z.strictObject({
  command: previewTributeImportSchema,
  rows: z.array(tributePreviewRowSchema),
  tiers: z.array(tierSnapshotSchema),
});
/** Persistent source facts and receipts; Billing holds catalog eligibility stable around assignment. */
export class TributeSources {
  private readonly clock: () => Date;
  constructor(private readonly dependencies: Dependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }
  private async permitted(actorId: string) {
    if (!z.uuid().safeParse(actorId).success) return false;
    const decision = await this.dependencies.accounts.checkPermission({
      accountId: actorId,
      permission: "billing:manage",
    });
    return decision.ok && decision.allowed;
  }
  async policies() {
    const rows = await this.dependencies.prisma.tributePolicy.findMany({
      orderBy: { id: "asc" },
      take: 101,
    });
    if (rows.length > 100) throw new Error("Tribute policy bound exceeded");
    return rows.map((row) =>
      tributePolicySchema.parse({
        id: row.id,
        subscriptionId: row.subscriptionId,
        revision: row.revision,
        enabled: row.enabled,
        tier: row.tierSnapshot,
        temporaryUntil: row.temporaryUntil?.toISOString() ?? null,
      }),
    );
  }
  async savePolicy(actorId: string, input: unknown, tierInput: unknown) {
    if (!(await this.permitted(actorId))) return accessFailure("forbidden");
    const parsed = saveTributePolicySchema.safeParse(input);
    const tier = tierSnapshotSchema.safeParse(tierInput);
    if (!parsed.success || !tier.success) return accessFailure("invalid_input");
    const command = parsed.data;
    const now = this.clock();
    if (
      tier.data.id !== command.tierId ||
      tier.data.revision !== command.tierRevision
    )
      return accessFailure("revision_conflict");
    if (
      command.temporaryUntil !== null &&
      new Date(command.temporaryUntil) <= now
    )
      return accessFailure("invalid_input");
    return this.dependencies.prisma.$transaction(async (tx) => {
      const fingerprint = accessFingerprint({
        action: "tribute.policy",
        command,
      });
      const previous = await readAccessReceipt(
        tx,
        actorId,
        command.operationId,
      );
      if (previous)
        return fingerprint.recognizes(previous.fingerprint)
          ? {
              ok: true as const,
              value: tributePolicySchema.parse(previous.result),
            }
          : accessFailure("operation_conflict");
      await lockAccountAccess(tx, "tribute:policies");
      const current = await tx.tributePolicy.findUnique({
        where: { id: command.id },
      });
      if ((current?.revision ?? 0) !== command.expectedRevision)
        return accessFailure("revision_conflict");
      if (current && current.subscriptionId !== command.subscriptionId)
        return accessFailure("identity_conflict");
      const collision = await tx.tributePolicy.findUnique({
        where: { subscriptionId: command.subscriptionId },
      });
      if (collision && collision.id !== command.id)
        return accessFailure("identity_conflict");
      const value = tributePolicySchema.parse({
        id: command.id,
        subscriptionId: command.subscriptionId,
        revision: command.expectedRevision + 1,
        enabled: command.enabled,
        tier: tier.data,
        temporaryUntil: command.temporaryUntil,
      });
      const data = {
        subscriptionId: value.subscriptionId,
        revision: value.revision,
        enabled: value.enabled,
        tierSnapshot: value.tier,
        temporaryUntil:
          value.temporaryUntil === null ? null : new Date(value.temporaryUntil),
        reason: command.reason,
      };
      await tx.tributePolicy.upsert({
        where: { id: value.id },
        create: { id: value.id, ...data },
        update: data,
      });
      await tx.accessReceipt.create({
        data: {
          scope: actorId,
          operationId: command.operationId,
          fingerprint: fingerprint.digest,
          payload: command,
          result: value,
          createdAt: now,
        },
      });
      return { ok: true as const, value };
    });
  }
  // `previous` is this row as a stored preview evaluated it. A preview stored before #732 holds the version 1
  // binding digest; the same recipient keeps that value, so the row still compares equal.
  private async evaluate(
    tx: MembershipEntitlementsPrisma,
    row: TributeImportRow,
    now: Date,
    previous?: z.infer<typeof tributePreviewRowSchema>,
  ) {
    const policy = await tx.tributePolicy.findUnique({
      where: { id: row.policyRef },
    });
    const ref =
      row.identityRef === null
        ? null
        : sourceIdentityRef("tribute", row.policyRef, row.identityRef);
    const source =
      ref === null
        ? null
        : await tx.sourceEntitlement.findUnique({
            where: { origin_sourceRef: { origin: "tribute", sourceRef: ref } },
          });
    const prior =
      source?.tributeState == null
        ? null
        : tributeStateSchema.parse(source.tributeState);
    const enrollment =
      source?.enrollmentId == null
        ? null
        : await tx.subscriptionEnrollment.findUnique({
            where: { id: source.enrollmentId },
          });
    const link =
      row.identityRef === null
        ? null
        : await this.dependencies.links.findCurrentByIdentity(row.identityRef);
    const previousStart = prior?.startsAt ?? enrollment?.startsAt.toISOString();
    const previousEnd = prior?.endsAt ?? enrollment?.endsAt?.toISOString();
    const wasConfirmed =
      prior?.mode === "confirmed_period" ||
      enrollment?.endPolicy === "confirmed_external";
    const binding =
      link?.ok && link.state === "found"
        ? accessFingerprint(link.recipient)
        : null;
    const result = {
      rowRef: row.rowRef,
      status: "matched" as z.infer<typeof tributePreviewRowSchema>["status"],
      detail: "Подтверждённое обновление",
      sourceId: source?.id ?? null,
      accountId:
        link?.ok && link.state === "found" ? link.recipient.accountId : null,
      bindingFingerprint:
        binding === null
          ? null
          : previous?.bindingFingerprint != null &&
              binding.recognizes(previous.bindingFingerprint)
            ? previous.bindingFingerprint
            : binding.digest,
      sourceRevision: source?.revision ?? 0,
      policyRevision: policy?.revision ?? 0,
      enrollmentRevision: enrollment?.revision ?? 0,
      shortens:
        (previousStart !== undefined &&
          row.startsAt !== null &&
          Date.parse(row.startsAt) > Date.parse(previousStart)) ||
        (previousEnd !== undefined &&
          row.endsAt !== null &&
          Date.parse(row.endsAt) < Date.parse(previousEnd)) ||
        (wasConfirmed && row.mode === "temporary_membership"),
      tier:
        prior?.tier ??
        (policy === null
          ? null
          : tierSnapshotSchema.parse(policy.tierSnapshot)),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    };
    if (
      policy === null ||
      !policy.enabled ||
      row.subscriptionId !== policy.subscriptionId
    ) {
      result.status = "conflict";
      result.detail = "Источник отсутствует, остановлен или не совпадает";
    } else if (
      row.identityRef === null ||
      row.telegramUserId === null ||
      row.verificationRef === null ||
      link === null ||
      !link.ok ||
      link.state === "ambiguous"
    ) {
      result.status = "ambiguous";
      result.detail =
        "Нужно подтверждённое сопоставление identity; имя не используется";
    } else if (
      new Date(row.checkedAt) > now ||
      row.startsAt === null ||
      row.endsAt === null ||
      Date.parse(row.endsAt) <= Date.parse(row.startsAt) ||
      (row.mode === "temporary_membership" &&
        (policy.temporaryUntil === null ||
          Date.parse(row.endsAt) > policy.temporaryUntil.getTime()))
    ) {
      result.status = "unknown_term";
      result.detail =
        "Нужны явные подтверждённые границы и разрешение временного режима";
    } else if (
      (source?.revision ?? 0) !== row.expectedRevision ||
      source?.revokedAt != null ||
      enrollment?.revokedAt != null ||
      (prior !== null &&
        (prior.telegramUserId !== row.telegramUserId ||
          prior.subscriptionId !== row.subscriptionId)) ||
      (source?.accountId != null && source.accountId !== result.accountId)
    ) {
      result.status = "conflict";
      result.detail =
        "Изменилась revision, identity или основание отозвано; требуется отдельное решение";
    } else {
      const collision = await tx.sourceEntitlement.findFirst({
        where: {
          origin: "tribute",
          AND: [
            {
              tributeState: {
                path: ["subscriptionId"],
                equals: row.subscriptionId,
              },
            },
            {
              tributeState: {
                path: ["telegramUserId"],
                equals: row.telegramUserId,
              },
            },
          ],
          ...(source === null ? {} : { id: { not: source.id } }),
        },
      });
      if (collision) {
        result.status = "conflict";
        result.detail = "Внешний получатель уже сопоставлен другой identity";
      } else if (link.state === "not_found") {
        result.status = "pending_identity";
        result.detail = "Сохранится до подтверждённой регистрации и linking";
      } else if (source === null) {
        result.status = "new";
        result.detail = "Новое подтверждённое основание";
      }
    }
    return tributePreviewRowSchema.parse(result);
  }
  async preview(actorId: string, input: unknown) {
    if (!(await this.permitted(actorId))) return accessFailure("forbidden");
    const parsed = previewTributeImportSchema.safeParse(input);
    if (!parsed.success) return accessFailure("invalid_input");
    const command = parsed.data;
    const now = this.clock();
    return this.dependencies.prisma.$transaction(async (tx) => {
      const fingerprint = accessFingerprint({
        action: "tribute.preview",
        command,
      });
      const receipt = await readAccessReceipt(tx, actorId, command.operationId);
      if (receipt)
        return fingerprint.recognizes(receipt.fingerprint)
          ? {
              ok: true as const,
              value: tributePreviewSchema.parse(receipt.result),
            }
          : accessFailure("operation_conflict");
      const rows = [];
      for (const row of command.rows)
        rows.push(await this.evaluate(tx, row, now));
      // The same external identity twice in one batch is an operator conflict, not two grants.
      for (const row of command.rows)
        if (
          row.telegramUserId !== null &&
          command.rows.filter(
            (other) =>
              (other.subscriptionId === row.subscriptionId &&
                other.telegramUserId === row.telegramUserId) ||
              (row.identityRef !== null &&
                other.policyRef === row.policyRef &&
                other.identityRef === row.identityRef),
          ).length > 1
        ) {
          const target = rows.find((value) => value.rowRef === row.rowRef);
          if (target) {
            target.status = "conflict";
            target.detail = "Повтор внешнего получателя внутри batch";
          }
        }
      const value = {
        previewRef: randomUUID(),
        batchRef: command.batchRef,
        expiresAt: new Date(
          now.getTime() + importPreviewLifetimeMilliseconds,
        ).toISOString(),
        rows,
      };
      await tx.accessBatchPreview.create({
        data: {
          id: value.previewRef,
          actorId,
          operationId: command.operationId,
          fingerprint: fingerprint.digest,
          rows: {
            command,
            rows,
            tiers: rows.flatMap((row) => (row.tier === null ? [] : [row.tier])),
          },
          revision: 1,
          expiresAt: new Date(value.expiresAt),
        },
      });
      await tx.tributeImportReview.create({
        data: {
          id: value.previewRef,
          actorId,
          batchRef: value.batchRef,
          pendingRows: rows.map((row) => row.rowRef),
          state: "pending",
          revision: 1,
          expiresAt: new Date(value.expiresAt),
          reason: "Awaiting owner decision",
        },
      });
      await tx.accessReceipt.create({
        data: {
          scope: actorId,
          operationId: command.operationId,
          fingerprint: fingerprint.digest,
          payload: command,
          result: value,
          createdAt: now,
        },
      });
      return { ok: true as const, value };
    });
  }
  async previewTiers(actorId: string, input: unknown) {
    if (!(await this.permitted(actorId))) return accessFailure("forbidden");
    const parsed = applyTributeImportSchema.safeParse(input);
    if (!parsed.success) return accessFailure("invalid_input");
    const receipt = await this.dependencies.prisma.accessReceipt.findUnique({
      where: {
        scope_operationId: {
          scope: actorId,
          operationId: parsed.data.operationId,
        },
      },
    });
    // A lost-response replay must return its receipt even after catalog archival.
    if (receipt !== null)
      return { ok: true as const, value: [] as TierSnapshot[] };
    const row = await this.dependencies.prisma.accessBatchPreview.findUnique({
      where: { id: parsed.data.previewRef },
    });
    if (row === null || row.actorId !== actorId)
      return accessFailure("not_found");
    const stored = storedPreviewSchema.parse(row.rows);
    return {
      ok: true as const,
      value: stored.rows
        .filter(
          (item) =>
            parsed.data.selectedRows.includes(item.rowRef) &&
            item.enrollmentRevision === 0,
        )
        .flatMap((item) => (item.tier === null ? [] : [item.tier])),
    };
  }
  async apply(actorId: string, input: unknown) {
    if (!(await this.permitted(actorId))) return accessFailure("forbidden");
    const parsed = applyTributeImportSchema.safeParse(input);
    if (!parsed.success) return accessFailure("invalid_input");
    const command = parsed.data;
    const now = this.clock();
    return this.dependencies.prisma.$transaction(async (tx) => {
      const fingerprint = accessFingerprint({
        action: "tribute.apply",
        command,
      });
      const receipt = await readAccessReceipt(tx, actorId, command.operationId);
      if (receipt)
        return fingerprint.recognizes(receipt.fingerprint)
          ? {
              ok: true as const,
              value: tributeApplyResultSchema.parse(receipt.result),
            }
          : accessFailure("operation_conflict");
      await lockAccountAccess(tx, `tribute:preview:${command.previewRef}`);
      const review = await tx.tributeImportReview.findUnique({
        where: { id: command.previewRef },
      });
      if (review === null || review.state === "dismissed")
        return accessFailure("preview_expired");
      const preview = await tx.accessBatchPreview.findUnique({
        where: { id: command.previewRef },
      });
      if (preview === null || preview.actorId !== actorId)
        return accessFailure("not_found");
      if (preview.expiresAt <= now) return accessFailure("preview_expired");
      const stored = storedPreviewSchema.parse(preview.rows);
      const selected = stored.command.rows.filter((row) =>
        command.selectedRows.includes(row.rowRef),
      );
      if (selected.length !== command.selectedRows.length)
        return accessFailure("invalid_input");
      const foundAccounts = stored.rows
        .filter((row) => command.selectedRows.includes(row.rowRef))
        .flatMap((row) => (row.accountId === null ? [] : [row.accountId]));
      const orderedAccounts = [...new Set(foundAccounts)].sort();
      for (const accountId of orderedAccounts)
        await lockTelegramAccountBinding(tx, accountId);
      const sourceRefs = selected.map((row) =>
        sourceIdentityRef("tribute", row.policyRef, row.identityRef ?? ""),
      );
      for (const ref of [...new Set(sourceRefs)].sort())
        await lockAccountAccess(tx, `enrollment:tribute:${ref}`);
      await lockAccountAccess(tx, "tribute:policies");
      // Binding → sorted sources → policy → all sorted accounts → row mutations.
      // Taking accounts lazily after source UPSERT reverses generic owner changes and batch expansion.
      for (const accountId of orderedAccounts)
        await lockAccountEntitlementChanges(tx, accountId);
      for (const row of selected) {
        const prior = stored.rows.find((value) => value.rowRef === row.rowRef);
        if (
          !prior ||
          !["new", "matched", "pending_identity"].includes(prior.status)
        )
          return accessFailure("invalid_input");
        const current = await this.evaluate(tx, row, now, prior);
        if (JSON.stringify(prior) !== JSON.stringify(current))
          return accessFailure("revision_conflict");
      }
      const sources = [];
      for (const row of selected) {
        if (
          row.identityRef === null ||
          row.telegramUserId === null ||
          row.subscriptionId === null ||
          row.verificationRef === null ||
          row.startsAt === null ||
          row.endsAt === null
        )
          return accessFailure("invalid_input");
        const evaluated = stored.rows.find(
          (value) => value.rowRef === row.rowRef,
        );
        if (evaluated?.tier == null) return accessFailure("invalid_input");
        const sourceRef = sourceIdentityRef(
          "tribute",
          row.policyRef,
          row.identityRef,
        );
        const old = await tx.sourceEntitlement.findUnique({
          where: { origin_sourceRef: { origin: "tribute", sourceRef } },
        });
        const before =
          old?.tributeState == null
            ? null
            : tributeStateSchema.parse(old.tributeState);
        const state: TributeState = {
          subscriptionId: row.subscriptionId,
          telegramUserId: row.telegramUserId,
          verificationRef: row.verificationRef,
          mode: row.mode,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          renewal: row.renewal,
          tier: before?.tier ?? evaluated.tier,
          policyRevision: evaluated.policyRevision,
          observation:
            row.mode === "confirmed_period"
              ? "pending"
              : (before?.observation ?? "pending"),
          observedUntil:
            row.mode === "confirmed_period"
              ? null
              : (before?.observedUntil ?? null),
          observationVersion: before?.observationVersion ?? null,
          lastEventAt: row.checkedAt,
          lastEventFingerprint: null,
        };
        const data = {
          tributeState: state,
          checkedAt: new Date(row.checkedAt),
          evidence: row,
          revision: (old?.revision ?? 0) + 1,
        };
        const saved = await tx.sourceEntitlement.upsert({
          where: { origin_sourceRef: { origin: "tribute", sourceRef } },
          create: {
            id: randomUUID(),
            origin: "tribute",
            sourceRef,
            sourcePolicyRef: row.policyRef,
            identityRef: row.identityRef,
            ...data,
          },
          update: data,
        });
        if (evaluated.accountId !== null) {
          const projected = await projectTributeSource(
            tx,
            saved,
            state,
            evaluated.accountId,
            actorId,
            row.reason,
            now,
          );
          if (!projected.ok)
            throw new Error("Binding changed during locked Tribute apply");
        }
        const after = await tx.sourceEntitlement.findUniqueOrThrow({
          where: { id: saved.id },
        });
        sources.push(tributeSourceView(after, now));
      }
      const pendingRows = z
        .array(z.string())
        .parse(review.pendingRows)
        .filter((row) => !command.selectedRows.includes(row));
      await tx.tributeImportReview.update({
        where: { id: review.id },
        data: {
          pendingRows,
          state: pendingRows.length === 0 ? "applied" : "pending",
          revision: { increment: 1 },
        },
      });
      const value = { previewRef: command.previewRef, sources };
      await tx.accessReceipt.create({
        data: {
          scope: actorId,
          operationId: command.operationId,
          fingerprint: fingerprint.digest,
          payload: { command, before: stored.rows, after: sources },
          result: value,
          createdAt: now,
        },
      });
      return { ok: true as const, value };
    });
  }
  async status(actorId: string, page = 0) {
    if (!z.int().min(0).max(100000).safeParse(page).success)
      return accessFailure("invalid_input");
    if (!(await this.permitted(actorId))) return accessFailure("forbidden");
    const now = this.clock();
    const prisma = this.dependencies.prisma;
    const rows = await prisma.sourceEntitlement.findMany({
      where: { origin: "tribute", tributeState: { path: ["mode"], not: "" } },
      orderBy: { id: "asc" },
      take: 101,
      skip: page * 100,
    });
    const unconfirmedWhere = {
      origin: "tribute",
      revokedAt: null,
      tributeState: { equals: Prisma.DbNull },
    };
    const unconfirmed = await prisma.sourceEntitlement.findMany({
      where: unconfirmedWhere,
      orderBy: { id: "asc" },
      take: 101,
      skip: page * 100,
    });
    const unconfirmedCount = await prisma.sourceEntitlement.count({
      where: unconfirmedWhere,
    });
    const sources = rows
      .slice(0, 100)
      .map((row) => tributeSourceView(row, now));
    const inbox = await prisma.tributeInbox.findMany({
      orderBy: { id: "asc" },
      take: 101,
      skip: page * 100,
    });
    const reviews = await prisma.tributeImportReview.findMany({
      orderBy: { id: "asc" },
      take: 101,
      skip: page * 100,
    });
    const unresolvedImports = await prisma.tributeImportReview.count({
      where: { state: "pending" },
    });
    const unresolvedEvents = await prisma.tributeInbox.count({
      where: { state: { in: ["received", "pending_reconciliation"] } },
    });
    const pendingIdentity = await prisma.sourceEntitlement.count({
      where: { origin: "tribute", accountId: null, revokedAt: null },
    });
    const temporarySources = await prisma.sourceEntitlement.count({
      where: {
        origin: "tribute",
        revokedAt: null,
        AND: [
          { tributeState: { path: ["mode"], equals: "temporary_membership" } },
          { tributeState: { path: ["endsAt"], gt: now.toISOString() } },
        ],
      },
    });
    const staleConfirmations = await prisma.sourceEntitlement.count({
      where: {
        origin: "tribute",
        revokedAt: null,
        tributeState: { path: ["endsAt"], gt: now.toISOString() },
        checkedAt: {
          lt: new Date(now.getTime() - sourceConfirmationFreshnessMilliseconds),
        },
      },
    });
    return {
      ok: true as const,
      value: tributeOperationsViewSchema.parse({
        page,
        hasMore:
          unconfirmed.length > 100 ||
          rows.length > 100 ||
          inbox.length > 100 ||
          reviews.length > 100,
        imports: reviews.slice(0, 100).map(importReviewView),
        policies: await this.policies(),
        sources,
        unconfirmedSources: unconfirmed.slice(0, 100).map((row) => ({
          id: row.id,
          sourceRef: row.sourceRef,
          policyRef: row.sourcePolicyRef,
          identityRef: row.identityRef,
          revision: row.revision,
        })),
        inbox: inbox.slice(0, 100).map(tributeInboxView),
        metrics: {
          unresolvedImports,
          pendingIdentity,
          unresolvedEvents,
          temporarySources,
          staleConfirmations,
          rolloutBlocked:
            unconfirmedCount > 0 ||
            unresolvedImports > 0 ||
            pendingIdentity > 0 ||
            unresolvedEvents > 0 ||
            temporarySources > 0 ||
            staleConfirmations > 0,
        },
      }),
    };
  }
  async dismissImport(actorId: string, input: unknown) {
    if (!(await this.permitted(actorId))) return accessFailure("forbidden");
    const parsed = dismissTributeImportSchema.safeParse(input);
    if (!parsed.success) return accessFailure("invalid_input");
    const command = parsed.data;
    return this.dependencies.prisma.$transaction(async (tx) => {
      const fingerprint = accessFingerprint({
        action: "tribute.dismissImport",
        command,
      });
      const receipt = await readAccessReceipt(tx, actorId, command.operationId);
      if (receipt)
        return fingerprint.recognizes(receipt.fingerprint)
          ? {
              ok: true as const,
              value: tributeImportReviewSchema.parse(receipt.result),
            }
          : accessFailure("operation_conflict");
      await lockAccountAccess(tx, `tribute:preview:${command.previewRef}`);
      const row = await tx.tributeImportReview.findUnique({
        where: { id: command.previewRef },
      });
      if (row === null || row.actorId !== actorId)
        return accessFailure("not_found");
      if (row.revision !== command.expectedRevision || row.state !== "pending")
        return accessFailure("revision_conflict");
      const saved = await tx.tributeImportReview.update({
        where: { id: row.id },
        data: {
          state: "dismissed",
          reason: command.reason,
          revision: { increment: 1 },
        },
      });
      const value = importReviewView(saved);
      await tx.accessReceipt.create({
        data: {
          scope: actorId,
          operationId: command.operationId,
          fingerprint: fingerprint.digest,
          payload: command,
          result: value,
          createdAt: this.clock(),
        },
      });
      return { ok: true as const, value };
    });
  }
  receive(raw: Buffer, input: unknown) {
    return receiveTribute(this.dependencies.prisma, raw, input, this.clock());
  }
  async retryEvent(actorId: string, input: unknown) {
    if (!(await this.permitted(actorId))) return accessFailure("forbidden");
    const parsed = retryTributeInboxSchema.safeParse(input);
    if (!parsed.success) return accessFailure("invalid_input");
    const command = parsed.data;
    const now = this.clock();
    return this.dependencies.prisma.$transaction(async (tx) => {
      const fingerprint = accessFingerprint({
        action: "tribute.retryEvent",
        command,
      });
      const receipt = await readAccessReceipt(tx, actorId, command.operationId);
      if (receipt)
        return fingerprint.recognizes(receipt.fingerprint)
          ? {
              ok: true as const,
              value: tributeInboxViewSchema.parse(receipt.result),
            }
          : accessFailure("operation_conflict");
      const event = await tx.tributeInbox.findUnique({
        where: { id: command.inboxId },
      });
      if (!event) return accessFailure("not_found");
      await lockAccountAccess(tx, `tribute:inbox:${event.eventKey}`);
      const current = await tx.tributeInbox.findUniqueOrThrow({
        where: { id: event.id },
      });
      if (current.revision !== command.expectedRevision)
        return accessFailure("revision_conflict");
      if (command.action === "reject" && current.state === "applied")
        return accessFailure("revision_conflict");
      const value =
        command.action === "reject"
          ? tributeInboxView(
              await tx.tributeInbox.update({
                where: { id: current.id },
                data: {
                  state: "rejected",
                  reason: "owner_rejected",
                  updatedAt: now,
                  revision: { increment: 1 },
                },
              }),
            )
          : await reconcileTributeEvent(tx, current.id, now);
      await tx.accessReceipt.create({
        data: {
          scope: actorId,
          operationId: command.operationId,
          fingerprint: fingerprint.digest,
          payload: command,
          result: value,
          createdAt: now,
        },
      });
      return { ok: true as const, value };
    });
  }
  async reconcile(actorId: string, input: unknown) {
    if (!(await this.permitted(actorId))) return accessFailure("forbidden");
    const parsed = reconcileTributeSchema.safeParse(input);
    if (!parsed.success) return accessFailure("invalid_input");
    const command = parsed.data;
    const now = this.clock();
    return this.dependencies.prisma.$transaction(async (tx) => {
      const fingerprint = accessFingerprint({
        action: "tribute.reconcile",
        command,
      });
      const receipt = await readAccessReceipt(tx, actorId, command.operationId);
      if (receipt)
        return fingerprint.recognizes(receipt.fingerprint)
          ? {
              ok: true as const,
              value: tributeSourceViewSchema.parse(receipt.result),
            }
          : accessFailure("operation_conflict");
      const initial = await tx.sourceEntitlement.findUnique({
        where: { id: command.sourceId },
      });
      if (
        !initial ||
        initial.origin !== "tribute" ||
        initial.tributeState == null
      )
        return accessFailure("not_found");
      if (initial.accountId !== null)
        await lockTelegramAccountBinding(tx, initial.accountId);
      await lockAccountAccess(tx, `enrollment:tribute:${initial.sourceRef}`);
      const source = await tx.sourceEntitlement.findUniqueOrThrow({
        where: { id: initial.id },
      });
      if (source.revision !== command.expectedRevision)
        return accessFailure("revision_conflict");
      const state = tributeStateSchema.parse(source.tributeState);
      if (
        command.action === "restore" &&
        source.revokedAt === null &&
        state.observation !== "source_ended"
      )
        return accessFailure("revision_conflict");
      if (command.action === "retry") {
        await tx.sourceEntitlement.update({
          where: { id: source.id },
          data: { reconcileAt: null },
        });
      } else {
        const next = tributeStateSchema.parse({
          ...state,
          startsAt: command.confirmedTerms?.startsAt ?? state.startsAt,
          endsAt: command.confirmedTerms?.endsAt ?? state.endsAt,
          verificationRef:
            command.confirmedTerms?.verificationRef ?? state.verificationRef,
          mode: command.action === "restore" ? "confirmed_period" : state.mode,
          observation:
            command.action === "restore" ? "pending" : state.observation,
          lastEventAt: now.toISOString(),
          lastEventFingerprint: null,
        });
        if (source.enrollmentId !== null) {
          const enrollment = await tx.subscriptionEnrollment.findUniqueOrThrow({
            where: { id: source.enrollmentId },
          });
          const changed = await changeEnrollmentInTransaction(
            tx,
            actorId,
            {
              operationId: randomUUID(),
              enrollmentId: enrollment.id,
              expectedRevision: enrollment.revision,
              action:
                command.action === "restore" && enrollment.revokedAt === null
                  ? "change_term"
                  : command.action,
              terms: {
                startsAt: next.startsAt,
                endsAt: next.endsAt,
                endPolicy:
                  next.mode === "confirmed_period"
                    ? "confirmed_external"
                    : "temporary_membership",
              },
              reason: command.reason,
            },
            now,
          );
          if (!changed.ok)
            throw new Error("Locked Tribute enrollment change failed");
        }
        await tx.sourceEntitlement.update({
          where: { id: source.id },
          data: {
            tributeState: next,
            revokedAt:
              command.action === "revoke" ? (source.revokedAt ?? now) : null,
            checkedAt: now,
            revision: source.revision + 1,
            reconcileAt: null,
            evidence: { method: "owner_source_resolution", actorId, command },
          },
        });
      }
      const value = tributeSourceView(
        await tx.sourceEntitlement.findUniqueOrThrow({
          where: { id: source.id },
        }),
        now,
      );
      await tx.accessReceipt.create({
        data: {
          scope: actorId,
          operationId: command.operationId,
          fingerprint: fingerprint.digest,
          payload: command,
          result: value,
          createdAt: now,
        },
      });
      return { ok: true as const, value };
    });
  }
  /** Bounded recoverable reconciliation, independent of community provider enablement. */
  async sweep(eligibleTierIds: readonly string[], limit = 50) {
    const now = this.clock();
    const prisma = this.dependencies.prisma;
    const rows = await prisma.sourceEntitlement.findMany({
      where: {
        origin: "tribute",
        OR: [{ reconcileAt: null }, { reconcileAt: { lte: now } }],
      },
      orderBy: [
        { reconcileAt: { sort: "asc", nulls: "first" } },
        { id: "asc" },
      ],
      take: Math.min(100, Math.max(1, limit)),
    });
    let attached = 0;
    let pending = 0;
    for (const candidate of rows) {
      const state = tributeStateSchema.safeParse(candidate.tributeState);
      if (!state.success) {
        await prisma.sourceEntitlement.update({
          where: { id: candidate.id },
          data: {
            reconcileAt: new Date(
              now.getTime() + reconciliationIntervalMilliseconds,
            ),
          },
        });
        pending++;
        continue;
      }
      const link = await this.dependencies.links.findCurrentByIdentity(
        candidate.identityRef,
      );
      await prisma.$transaction(async (tx) => {
        if (link.ok && link.state === "found")
          await lockTelegramAccountBinding(tx, link.recipient.accountId);
        await lockAccountAccess(
          tx,
          `enrollment:tribute:${candidate.sourceRef}`,
        );
        const row = await tx.sourceEntitlement.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        const accountIds = [
          row.accountId,
          link.ok && link.state === "found" ? link.recipient.accountId : null,
        ].filter((id): id is string => id !== null);
        for (const accountId of [...new Set(accountIds)].sort())
          await lockAccountEntitlementChanges(tx, accountId);
        await tx.sourceEntitlement.update({
          where: { id: row.id },
          data: {
            reconcileAt: new Date(
              now.getTime() + reconciliationIntervalMilliseconds,
            ),
          },
        });
        if (row.accountId !== null && row.enrollmentId !== null) return;
        const policy = await tx.tributePolicy.findUnique({
          where: { id: row.sourcePolicyRef },
        });
        if (
          !link.ok ||
          link.state !== "found" ||
          !policy?.enabled ||
          !eligibleTierIds.includes(state.data.tier.id)
        ) {
          pending++;
          return;
        }
        const current = await this.dependencies.links.readBinding({
          accountId: link.recipient.accountId,
        });
        if (
          !current.ok ||
          current.binding?.accountRef !== link.recipient.accountRef ||
          current.binding.telegramIdentityRef !== row.identityRef ||
          current.binding.linkRef !== link.recipient.linkRef ||
          current.binding.linkRevision !== link.recipient.linkRevision
        ) {
          pending++;
          return;
        }
        const fresh = tributeStateSchema.parse(row.tributeState);
        const result = await projectTributeSource(
          tx,
          row,
          fresh,
          link.recipient.accountId,
          null,
          "Сопоставление подтверждённого Tribute после linking",
          now,
        );
        if (result.ok) attached++;
        else pending++;
      });
    }
    return { scanned: rows.length, attached, pending };
  }
}

function importReviewView(row: {
  id: string;
  batchRef: string;
  revision: number;
  state: string;
  pendingRows: unknown;
  expiresAt: Date;
  reason: string;
}) {
  return tributeImportReviewSchema.parse({
    previewRef: row.id,
    batchRef: row.batchRef,
    revision: row.revision,
    state: row.state,
    pendingRows: row.pendingRows,
    expiresAt: row.expiresAt.toISOString(),
    reason: row.reason,
  });
}
