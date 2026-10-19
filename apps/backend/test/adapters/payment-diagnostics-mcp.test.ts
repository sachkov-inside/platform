import { diagnosticDatabase } from "../fixtures/payment-diagnostics-database.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import { assembleInsideMcpServer } from "../../src/entrypoints/mcp/inside-mcp-server.js";
import { PaymentDiagnostics } from "../../src/modules/billing/features/read-payment-diagnostics/payment-diagnostics.js";
import { refusingMcpToolDependencies } from "../fixtures/inside-mcp-dependencies.js";

it("the diagnostic MCP tool declares read-only operation and enforces delegated platform admin", async () => {
  const accountId = "10000000-0000-4000-8000-000000000001";
  const prisma = diagnosticDatabase({ permissionGranted: false });
  const accounts = assembleAccounts({
    emailFingerprintKey: "synthetic-payment-diagnostics-fingerprint",
    prisma,
  });
  const diagnostics = new PaymentDiagnostics({
    accounts,
    prisma,
    grants: assembleAccessGrants({ accounts, prisma }),
  });
  const server = assembleInsideMcpServer({
    ...refusingMcpToolDependencies(),
    accountId,
    diagnostics,
  });
  const client = new Client({
    name: "payment-diagnostics-contract",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const { tools } = await client.listTools();
    expect(
      tools.find((tool) => tool.name === "payment_access_diagnostics"),
    ).toMatchObject({
      annotations: { readOnlyHint: true, destructiveHint: false },
    });
    const result = await client.callTool({
      name: "payment_access_diagnostics",
      arguments: { from: "2026-10-18T21:00:00Z", to: "2026-10-19T21:00:00Z" },
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "forbidden" } },
    });
  } finally {
    await client.close();
    await server.close();
  }
});

it.each([
  { state: "missing", grants: [], missingCount: 1, rightsFailure: false },
  {
    state: "granted",
    grants: [{ revokedAt: null }],
    missingCount: 0,
    rightsFailure: false,
  },
  {
    state: "revoked",
    grants: [{ revokedAt: new Date("2026-10-19T11:00:00Z") }],
    missingCount: 0,
    rightsFailure: false,
  },
  { state: "unknown", grants: [], missingCount: null, rightsFailure: true },
])(
  "reports $state paid-source evidence through the registered Platform MCP",
  async ({ state, grants, missingCount, rightsFailure }) => {
    const accountId = "10000000-0000-4000-8000-000000000001";
    const purchaseId = "20000000-0000-4000-8000-000000000001";
    const now = new Date("2026-10-19T12:00:00Z");
    const snapshot = {
      offer: {
        id: accountId,
        revision: 1,
        name: "Inside",
        benefits: ["materials"],
        archived: false,
      },
      paymentOption: {
        id: accountId,
        revision: 1,
        offerId: accountId,
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
    const prisma = diagnosticDatabase({
      rightsFailure,
      payments: [{ id: purchaseId, accountId, snapshot, confirmedAt: now }],
      grants: grants.map((row) => ({
        ...row,
        source: "paid",
        sourceRef: `${purchaseId}:materials`,
        accountId,
        capabilities: ["materials"],
        startsAt: now,
        validUntil: null,
      })),
    });
    const accounts = assembleAccounts({
      emailFingerprintKey: "synthetic-payment-diagnostics-fingerprint",
      prisma,
    });
    const diagnostics = new PaymentDiagnostics({
      accounts,
      prisma,
      grants: assembleAccessGrants({ accounts, prisma }),
      clock: () => now,
    });
    const server = assembleInsideMcpServer({
      ...refusingMcpToolDependencies(),
      accountId,
      diagnostics,
    });
    const client = new Client({
      name: "payment-diagnostics-evidence-contract",
      version: "1",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const result = await client.callTool({
        name: "payment_access_diagnostics",
        arguments: { from: "2026-10-18T21:00:00Z", to: "2026-10-19T21:00:00Z" },
      });
      expect(result).toMatchObject({
        structuredContent: {
          ok: true,
          value: {
            coverage: rightsFailure ? "partial" : "complete",
            counts: { confirmedPayments: 1, missingPaidGrant: missingCount },
            items: [
              {
                purchaseRef: purchaseId,
                payment: "confirmed",
                grants: [{ capability: "materials", state }],
              },
            ],
          },
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  },
);
