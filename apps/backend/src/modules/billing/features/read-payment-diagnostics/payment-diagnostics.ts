import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { AccessGrants } from "../../../account-rights/index.js";
import type { BillingPrisma } from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { priceSnapshotSchema } from "../../domain/pricing.js";

export const paymentDiagnosticsQuerySchema = z
  .strictObject({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    limit: z.int().min(1).max(50).default(20),
    cursor: z.string().max(2048).optional(),
  })
  .refine((value) => {
    const duration = Date.parse(value.to) - Date.parse(value.from);
    return duration > 0 && duration <= 31 * 24 * 60 * 60 * 1000;
  }, "A positive window of at most 31 days is required");

const cursorSchema = z.strictObject({
  v: z.literal(1),
  from: z.string(),
  to: z.string(),
  afterId: z.uuid(),
});

function readCursor(value: string | undefined) {
  if (value === undefined) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : false;
  } catch {
    // Not a dependency failure: a caller supplied a malformed continuation.
    return false;
  }
}

export class PaymentDiagnostics {
  constructor(
    private readonly dependencies: {
      readonly accounts: Pick<Accounts, "checkPermission">;
      readonly prisma: Pick<BillingPrisma, "billingPurchase" | "billingRefund">;
      readonly grants: Pick<AccessGrants, "readPaidGrantDiagnostics">;
      readonly clock?: () => Date;
    },
  ) {}

  async read(actorId: string, input: unknown) {
    const parsed = paymentDiagnosticsQuerySchema.safeParse(input);
    if (!z.uuid().safeParse(actorId).success || !parsed.success)
      return { ok: false as const, error: { code: "invalid_input" as const } };
    try {
      const permission = await this.dependencies.accounts.checkPermission({
        accountId: actorId,
        permission: "platform:admin",
      });
      if (!permission.ok && permission.error.code === "internal_error")
        return {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        };
      if (!permission.ok || !permission.allowed)
        return { ok: false as const, error: { code: "forbidden" as const } };
      const query = parsed.data;
      const from = new Date(query.from).toISOString();
      const to = new Date(query.to).toISOString();
      const cursor = readCursor(query.cursor);
      if (
        cursor === false ||
        (cursor !== null && (cursor.from !== from || cursor.to !== to))
      )
        return {
          ok: false as const,
          error: { code: "invalid_input" as const },
        };
      const observedAt = (
        this.dependencies.clock?.() ?? new Date()
      ).toISOString();
      const rows = await this.dependencies.prisma.billingPurchase.findMany({
        where: {
          state: "confirmed",
          confirmedAt: { gte: new Date(from), lt: new Date(to) },
          ...(cursor === null ? {} : { id: { gt: cursor.afterId } }),
        },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        select: {
          id: true,
          accountId: true,
          snapshot: true,
          confirmedAt: true,
        },
      });
      const page = rows.slice(0, query.limit);
      const snapshots = page.map((row) =>
        priceSnapshotSchema.safeParse(row.snapshot),
      );
      const keys = page.flatMap((row, index) => {
        const snapshot = snapshots[index];
        return snapshot?.success === true
          ? snapshot.data.offer.benefits.map((capability) => ({
              accountId: row.accountId,
              sourceRef: `${row.id}:${capability}`,
            }))
          : [];
      });
      const facts = [];
      let rightsUnavailable = false;
      for (let offset = 0; offset < keys.length; offset += 500) {
        const result = await this.dependencies.grants.readPaidGrantDiagnostics(
          keys.slice(offset, offset + 500),
        );
        if (!result.ok) rightsUnavailable = true;
        else facts.push(...result.values);
      }
      const byKey = new Map(
        facts.map((fact) => [
          JSON.stringify([fact.accountId, fact.sourceRef]),
          fact,
        ]),
      );
      const refs = page.map((row) => row.id);
      const refunds =
        refs.length === 0
          ? []
          : await this.dependencies.prisma.billingRefund.groupBy({
              by: ["purchaseRef"],
              where: { purchaseRef: { in: refs }, state: "confirmed" },
              _sum: { amountKopecks: true },
            });
      const refundByRef = new Map(
        refunds.map((row) => [
          row.purchaseRef,
          Number(row._sum.amountKopecks ?? 0),
        ]),
      );
      const items = page.map((row, index) => {
        const snapshot = snapshots[index];
        const grants =
          snapshot?.success === true
            ? snapshot.data.offer.benefits.map((capability) => {
                const fact = byKey.get(
                  JSON.stringify([row.accountId, `${row.id}:${capability}`]),
                );
                const state = rightsUnavailable
                  ? "unknown"
                  : fact === undefined
                    ? "missing"
                    : !fact.capabilities.includes(capability)
                      ? "unknown"
                      : fact.revokedAt !== null
                        ? "revoked"
                        : "granted";
                return {
                  capability,
                  state,
                  startsAt: fact?.startsAt ?? null,
                  validUntil: fact?.validUntil ?? null,
                };
              })
            : [];
        return {
          purchaseRef: row.id,
          accountId: row.accountId,
          payment: "confirmed" as const,
          confirmedAt: row.confirmedAt?.toISOString() ?? null,
          refundedKopecks: refundByRef.get(row.id) ?? 0,
          grants,
          facts: snapshot?.success === true ? "known" : "unknown",
        };
      });
      const unknown = items.filter(
        (item) =>
          item.facts === "unknown" ||
          item.grants.some((grant) => grant.state === "unknown"),
      ).length;
      return {
        ok: true as const,
        value: {
          window: {
            from: new Date(query.from).toISOString(),
            to: new Date(query.to).toISOString(),
            timezone: "Europe/Moscow",
          },
          observedAt,
          consistency: "independent_owner_reads",
          coverage:
            unknown > 0
              ? "partial"
              : rows.length > query.limit
                ? "paginated"
                : "complete",
          sources: {
            billing: "available",
            accountRights: rightsUnavailable
              ? "unavailable"
              : keys.length === 0
                ? "not_queried"
                : "available",
          },
          counts: {
            scope: "returned_page",
            confirmedPayments: items.length,
            missingPaidGrant:
              unknown > 0
                ? null
                : items.filter((item) =>
                    item.grants.some((grant) => grant.state === "missing"),
                  ).length,
            unknown,
          },
          items,
          order: "purchase_id_ascending",
          traversal: "live_source",
          nextCursor:
            rows.length > query.limit
              ? JSON.stringify({ v: 1, from, to, afterId: page.at(-1)?.id })
              : null,
        },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "readPaymentDiagnostics" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }
}
