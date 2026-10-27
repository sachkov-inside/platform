import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { readCommittedToolSurface } from "../../scripts/mcp-tool-surface-file.js";
import { ownerOperationSchema } from "../../src/modules/billing/domain/owner-operations.js";
import { BillingOperations } from "../../src/modules/billing/index.js";
import { OwnerOrderEmailRead } from "../../src/modules/billing/features/read-order-email/read-order-email.js";
import { Tbank } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../support/declared-api.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";
import {
  startTestIdentityIssuer,
  type TestIdentityIssuer,
} from "./setup/test-identity-issuer.js";

const orderEmail = "order@example.test";

let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

async function actorWith(permission: "materials:manage" | null) {
  const actor = randomUUID();
  await world.db.prisma.account.create({
    data: {
      id: actor,
      logtoIssuer: "https://identity.invalid",
      logtoSubject: actor,
    },
  });
  if (permission !== null)
    await world.db.prisma.accountPermission.create({
      data: { accountId: actor, permission },
    });
  return actor;
}

test("the billing owner reads the order email of one payment; other roles are refused", async () => {
  const s = await world.scenario();
  const { purchaseRef } = value(await s.payments.purchase(s.buyer, s.command));
  const read = new OwnerOrderEmailRead({
    prisma: world.db.prisma,
    accounts: s.accounts,
    bank: s.bank,
  });

  expect(await read.read(world.owner, purchaseRef)).toEqual({
    ok: true,
    value: { email: orderEmail },
  });
  for (const actor of [
    await actorWith("materials:manage"),
    await actorWith(null),
    s.buyer,
  ])
    expect(await read.read(actor, purchaseRef)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  for (const unknown of [randomUUID(), "not-a-reference"])
    expect(await read.read(world.owner, unknown)).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
});

test("without the bank key, or with another terminal's key, the order email is unavailable and never echoed", async () => {
  const s = await world.scenario();
  const { purchaseRef } = value(await s.payments.purchase(s.buyer, s.command));
  const otherTerminal = new Tbank(
    syntheticTbankConfig({
      environment: "demo",
      terminalKey: "OTHERTERMINAL",
      password: "synthetic-password",
      bindingEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
      minimumKopecks: 100,
      maximumKopecks: 1_000_000,
      returnUrl: "https://inside.example.test/account",
      notificationUrl: "https://inside.example.test/billing/tbank/notification",
      receipt: { taxation: "usn_income", tax: "none" },
    }),
    () => Promise.reject(new Error("No bank call is expected")),
  );
  for (const bank of [undefined, otherTerminal]) {
    const result = await new OwnerOrderEmailRead({
      prisma: world.db.prisma,
      accounts: s.accounts,
      bank,
    }).read(world.owner, purchaseRef);
    expect(result).toEqual({
      ok: false,
      error: { code: "dependency_unavailable" },
    });
  }
});

test("the order email is absent from payments.list, payments.read and the MCP tool list", async () => {
  const s = await world.scenario();
  const { purchaseRef } = value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("CONFIRMED");
  const owner = new BillingOperations({
    prisma: world.db.prisma,
    accounts: s.accounts,
    pricing: s.pricing,
    payments: s.payments,
    grants: s.grants,
    bank: s.bank,
  });
  const list = await owner.execute(world.owner, {
    operation: "payments.list",
    operationId: randomUUID(),
    accountId: s.buyer,
  });
  const read = await owner.execute(world.owner, {
    operation: "payments.read",
    operationId: randomUUID(),
    purchaseRef,
  });
  expect(list).toMatchObject({ ok: true });
  expect(read).toMatchObject({ ok: true });
  expect(JSON.stringify(list)).not.toContain(orderEmail);
  expect(JSON.stringify(read)).not.toContain(orderEmail);

  // The committed surface is the live MCP tool list: `mcp:check` and the MCP HTTP test hold it.
  const tools = readCommittedToolSurface();
  expect(tools).toContain("billing_payments_read");
  expect(tools).toContain("billing_promotions_list");
  expect(tools.filter((name) => /email|order/iu.test(name))).toEqual([]);
  expect(
    ownerOperationSchema.options
      .map((option) => option.shape.operation.value)
      .filter((operation) => /email/iu.test(operation)),
  ).toEqual([]);
});

describe("Owner Order Email over HTTP", () => {
  let identity: TestIdentityIssuer;
  let app: NestFastifyApplication;
  let server: DeclaredServer;

  beforeAll(async () => {
    identity = await startTestIdentityIssuer({
      issuer: "https://identity.order-email.test/oidc",
      audience: "https://api.order-email.test",
    });
    // The API process here has no bank terminal: an existing order cannot be opened.
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: world.db.url,
        LOGTO_ISSUER: identity.issuer,
        LOGTO_AUDIENCE: identity.audience,
        LOGTO_JWKS_URL: identity.jwksUrl,
        IDENTITY_EMAIL_FINGERPRINT_KEY:
          "order-email-test-email-fingerprint-key-000",
      }),
      { logger: false },
    );
    await app.init();
    server = declaredServer(app.getHttpAdapter().getInstance());
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
    await identity.close();
  });

  async function signedIn(
    permission: "materials:manage" | "billing:manage" | null,
  ): Promise<Record<string, string>> {
    const subject = `order-email-${randomUUID()}`;
    const bearer = await identity.sign(subject, {
      inside_verified_email: `${subject}@example.test`,
    });
    const headers = { authorization: `Bearer ${bearer}` };
    const created = await server.inject({
      method: "POST",
      url: "/accounts",
      headers,
    });
    expect(created.statusCode).toBe(201);
    if (permission !== null) {
      const account = await world.db.prisma.account.findFirstOrThrow({
        where: { logtoSubject: subject },
      });
      await world.db.prisma.accountPermission.create({
        data: { accountId: account.id, permission },
      });
    }
    return headers;
  }

  test("answers 401, 403, 404 and 503 as problems, never cached", async () => {
    const s = await world.scenario();
    const { purchaseRef } = value(
      await s.payments.purchase(s.buyer, s.command),
    );
    const url = (ref: string) => `/billing/admin/payments/${ref}/order-email`;
    expect(
      (await server.inject({ method: "GET", url: url(purchaseRef) }))
        .statusCode,
    ).toBe(401);
    for (const permission of ["materials:manage", null] as const) {
      const denied = await server.inject({
        method: "GET",
        url: url(purchaseRef),
        headers: await signedIn(permission),
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ code: "forbidden" });
      expect(denied.headers["cache-control"]).toBe("private, no-store");
    }
    const owner = await signedIn("billing:manage");
    const missing = await server.inject({
      method: "GET",
      url: url(randomUUID()),
      headers: owner,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "not_found" });
    const unavailable = await server.inject({
      method: "GET",
      url: url(purchaseRef),
      headers: owner,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({
      code: "dependency_unavailable",
    });
    expect(unavailable.headers["cache-control"]).toBe("private, no-store");
    expect(unavailable.body).not.toContain(orderEmail);
  });
});
