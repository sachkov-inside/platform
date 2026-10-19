import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import {
  PaymentDiagnostics,
  registerPaymentDiagnosticsTool,
} from "../../src/modules/billing/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const owner = "10000000-0000-4000-8000-000000000001";
const buyer = "10000000-0000-4000-8000-000000000002";
const operator = "10000000-0000-4000-8000-000000000003";
const firstPurchase = "20000000-0000-4000-8000-000000000001";
const secondPurchase = "20000000-0000-4000-8000-000000000002";
const outsideWindow = "20000000-0000-4000-8000-000000000003";
const pendingPurchase = "20000000-0000-4000-8000-000000000004";
const now = new Date("2026-10-19T12:00:00Z");
const input = {
  from: "2026-10-18T21:00:00Z",
  to: "2026-10-19T21:00:00Z",
  limit: 1,
};
const snapshot = {
  offer: {
    id: owner,
    revision: 1,
    name: "Inside",
    benefits: ["materials"],
    archived: false,
  },
  paymentOption: {
    id: owner,
    revision: 1,
    offerId: owner,
    months: 1,
    mode: "one_time",
    priceKopecks: 10000,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 10000,
  renewalPriceKopecks: 10000,
};
let database: TestDatabase;
beforeEach(async () => {
  database = await createMigratedTestDatabase();
  for (const id of [owner, buyer, operator])
    await database.prisma.account.create({
      data: {
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
      },
    });
  await database.prisma.accountPermission.createMany({
    data: [
      { accountId: owner, permission: "platform:admin" },
      { accountId: operator, permission: "billing:manage" },
    ],
  });
});
afterEach(async () => {
  await database.dispose();
});

function capabilities() {
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: "synthetic-payment-diagnostics-fingerprint",
  });
  const grants = assembleAccessGrants({
    prisma: database.prisma,
    accounts,
    clock: () => now,
  });
  const diagnostics = new PaymentDiagnostics({
    prisma: database.prisma,
    accounts,
    grants,
    clock: () => now,
  });
  return { grants, diagnostics };
}
async function seedPurchase(id: string, confirmedAt: Date | null) {
  await database.prisma.billingPriceQuote.create({
    data: {
      id,
      accountId: buyer,
      operationId: id,
      fingerprint: id,
      snapshot,
      createdAt: now,
      expiresAt: new Date("2026-10-19T13:00:00Z"),
    },
  });
  await database.prisma.billingPurchase.create({
    data: {
      id,
      accountId: buyer,
      quoteRef: id,
      lifecycleActive: false,
      kind: "one_time",
      state: confirmedAt === null ? "pending" : "confirmed",
      environment: "test",
      terminalRef: "synthetic",
      paymentId: id,
      amountKopecks: 10000n,
      snapshot,
      acceptance: {},
      contact: {},
      fiscalization: "pending",
      confirmedAt,
      createdAt: now,
      updatedAt: now,
    },
  });
}

it("reads confirmed payments through MCP and follows the bounded owner cursor without conflating other grants", async () => {
  await seedPurchase(firstPurchase, now);
  await seedPurchase(secondPurchase, now);
  await seedPurchase(outsideWindow, new Date(input.to));
  await seedPurchase(pendingPurchase, null);
  const { grants, diagnostics } = capabilities();
  // A different purchase's paid grant must not hide the missing first purchase's source.
  expect(
    await grants.applyPaidPeriod({
      eventRef: owner,
      accountId: buyer,
      periodRef: `${secondPurchase}:materials`,
      revision: 1,
      revoked: false,
      terms: {
        capabilities: ["materials"],
        startsAt: input.from,
        validUntil: null,
        reason: "Synthetic paid fixture",
      },
    }),
  ).toMatchObject({ ok: true });
  const server = new McpServer({
    name: "payment-diagnostics-postgres",
    version: "1",
  });
  registerPaymentDiagnosticsTool(server, { accountId: owner, diagnostics });
  const client = new Client({
    name: "payment-diagnostics-postgres-client",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const first = await client.callTool({
      name: "payment_access_diagnostics",
      arguments: input,
    });
    expect(first).toMatchObject({
      structuredContent: {
        ok: true,
        value: {
          coverage: "paginated",
          counts: { confirmedPayments: 1, missingPaidGrant: 1 },
          items: [
            {
              purchaseRef: firstPurchase,
              grants: [{ capability: "materials", state: "missing" }],
            },
          ],
        },
      },
    });
    const cursor = z
      .object({ value: z.object({ nextCursor: z.string() }) })
      .parse(first.structuredContent).value.nextCursor;
    const second = await client.callTool({
      name: "payment_access_diagnostics",
      arguments: { ...input, cursor },
    });
    expect(second).toMatchObject({
      structuredContent: {
        ok: true,
        value: {
          coverage: "complete",
          counts: { confirmedPayments: 1, missingPaidGrant: 0 },
          items: [
            {
              purchaseRef: secondPurchase,
              grants: [{ capability: "materials", state: "granted" }],
            },
          ],
          nextCursor: null,
        },
      },
    });
  } finally {
    await client.close();
    await server.close();
  }
});

it("denies a billing operator and a buyer, preserving the narrower admin diagnostic permission", async () => {
  const { diagnostics } = capabilities();
  for (const actor of [operator, buyer])
    expect(await diagnostics.read(actor, input)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
});
