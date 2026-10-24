import { diagnosticDatabase } from "../fixtures/payment-diagnostics-database.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { describe, expect, it, vi } from "vitest";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { PaymentDiagnostics } from "../../src/modules/billing/features/read-payment-diagnostics/payment-diagnostics.js";

const actor = "10000000-0000-4000-8000-000000000001";
const purchaseId = "20000000-0000-4000-8000-000000000001";
const snapshot = {
  offer: {
    id: actor,
    revision: 1,
    name: "Inside",
    benefits: ["materials"],
    archived: false,
  },
  paymentOption: {
    id: actor,
    revision: 1,
    offerId: actor,
    months: 1,
    priceKopecks: 10000,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 10000,
  renewalPriceKopecks: 10000,
};
function permittedAccounts(allowed = true) {
  return assembleAccounts({
    emailFingerprintKey: "synthetic-payment-diagnostics-fingerprint",
    prisma: diagnosticDatabase({ permissionGranted: allowed }),
  });
}
function assemble(
  rows: unknown[] = [],
  grantRows: unknown[] = [],
  rightsFailure = false,
) {
  const accounts = permittedAccounts();
  const prisma = diagnosticDatabase({
    payments: rows,
    grants: grantRows,
    rightsFailure,
  });
  const grants = assembleAccessGrants({ accounts, prisma });
  return new PaymentDiagnostics({
    accounts,
    grants,
    prisma,
    clock: () => new Date("2026-10-19T12:00:00Z"),
  });
}
const paid = {
  id: purchaseId,
  accountId: actor,
  snapshot,
  confirmedAt: new Date("2026-10-19T10:00:00Z"),
};
const window = {
  from: "2026-10-18T21:00:00Z",
  to: "2026-10-19T21:00:00Z",
  limit: 10,
};

describe("payment diagnostics", () => {
  it("refuses a billing operator without platform admin before reading payments", async () => {
    const prisma = diagnosticDatabase();
    const readPayments = vi.spyOn(prisma.billingPurchase, "findMany");
    const report = new PaymentDiagnostics({
      accounts: permittedAccounts(false),
      prisma,
      grants: assembleAccessGrants({
        accounts: permittedAccounts(false),
        prisma: diagnosticDatabase(),
      }),
    });
    expect(await report.read(actor, window)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(readPayments).not.toHaveBeenCalled();
  });
  it("reports a confirmed payment with no matching paid grant as missing, independently of unrelated access", async () => {
    const report = assemble(
      [paid],
      [
        {
          accountId: actor,
          source: "manual",
          sourceRef: "other",
          capabilities: ["materials"],
        },
      ],
    );
    expect(await report.read(actor, window)).toMatchObject({
      ok: true,
      value: {
        coverage: "complete",
        counts: { confirmedPayments: 1, missingPaidGrant: 1, unknown: 0 },
        items: [
          {
            purchaseRef: purchaseId,
            payment: "confirmed",
            grants: [{ capability: "materials", state: "missing" }],
            refundedKopecks: 0,
          },
        ],
        nextCursor: null,
      },
    });
  });
  it("keeps the paid source grant distinct from revoked or expired current access", async () => {
    const report = assemble(
      [paid],
      [
        {
          source: "paid",
          accountId: actor,
          sourceRef: `${purchaseId}:materials`,
          capabilities: ["materials"],
          startsAt: new Date("2026-10-01T00:00:00Z"),
          validUntil: new Date("2026-10-15T00:00:00Z"),
          revokedAt: null,
        },
      ],
    );
    expect(await report.read(actor, window)).toMatchObject({
      ok: true,
      value: {
        counts: { missingPaidGrant: 0, unknown: 0 },
        items: [
          {
            grants: [
              { state: "granted", validUntil: "2026-10-15T00:00:00.000Z" },
            ],
          },
        ],
      },
    });
  });
  it("does not report a malformed payment snapshot as zero missing benefits", async () => {
    expect(
      await assemble([{ ...paid, snapshot: {} }]).read(actor, window),
    ).toMatchObject({
      ok: true,
      value: {
        coverage: "partial",
        counts: { unknown: 1 },
        items: [{ facts: "unknown" }],
      },
    });
  });
  it("keeps truncated pages traversable and rejects a continuation under different filters", async () => {
    const report = assemble([
      paid,
      { ...paid, id: "20000000-0000-4000-8000-000000000002" },
    ]);
    const first = await report.read(actor, { ...window, limit: 1 });
    expect(first).toMatchObject({
      ok: true,
      value: {
        coverage: "paginated",
        counts: { confirmedPayments: 1 },
      },
    });
    if (!first.ok) throw new Error("Expected a diagnostic page");
    expect(
      await report.read(actor, {
        ...window,
        from: "2026-10-17T21:00:00Z",
        cursor: first.value.nextCursor,
      }),
    ).toEqual({ ok: false, error: { code: "invalid_input" } });
  });

  it("reports an unavailable rights source as partial and unknown, never zero missing rights", async () => {
    expect(await assemble([paid], [], true).read(actor, window)).toMatchObject({
      ok: true,
      value: {
        coverage: "partial",
        sources: { accountRights: "unavailable" },
        counts: { missingPaidGrant: null, unknown: 1 },
        items: [{ grants: [{ state: "unknown" }] }],
      },
    });
  });
  it("denies a delegated Account that no longer exists", async () => {
    const accounts = assembleAccounts({
      emailFingerprintKey: "synthetic-payment-diagnostics-fingerprint",
      prisma: diagnosticDatabase({ accountExists: false }),
    });
    const report = new PaymentDiagnostics({
      accounts,
      prisma: diagnosticDatabase(),
      grants: assembleAccessGrants({ accounts, prisma: diagnosticDatabase() }),
    });
    expect(await report.read(actor, window)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});
