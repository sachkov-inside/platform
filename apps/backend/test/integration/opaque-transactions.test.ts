import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assembleAccounts,
  accountId,
} from "../../src/modules/accounts/index.js";
import { verifiedAccountSignIn } from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import { transactionHandle } from "../../src/infrastructure/prisma/transaction-handle.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("opaque transaction owner handoff", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
  });
  afterAll(async () => {
    await db.dispose();
  });

  test("permission checks observe a caller's uncommitted revocation on the same connection", async () => {
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "opaque-transactions-email-key-00000000",
    });
    const subject = randomUUID();
    const proof = verifiedAccountSignIn({
      issuer: "https://identity.example",
      subject,
      verifiedEmail: `${subject}@example.com`,
    });
    const created = await accounts.establishAccount({
      identity: proof.identity,
    });
    if (!created.ok) throw new Error("Account creation failed");
    const query = {
      accountId: created.account.accountId,
      permission: "materials:manage" as const,
    };
    await db.prisma.accountPermission.create({
      data: { ...query, createdAt: new Date("2026-10-23T00:00:00.000Z") },
    });
    expect(await accounts.checkPermission(query)).toEqual({
      ok: true,
      allowed: true,
    });
    await expect(
      db.prisma.$transaction(async (tx) => {
        await tx.accountPermission.deleteMany({ where: query });
        expect(
          await accounts.checkPermission(query, transactionHandle(tx)),
        ).toEqual({ ok: true, allowed: false });
        throw new Error("roll back revocation");
      }),
    ).rejects.toThrow("roll back revocation");
    expect(await accounts.checkPermission(query)).toEqual({
      ok: true,
      allowed: true,
    });
  });

  test("a revoked author cannot cross the validation-to-transaction gap or claim a mutation receipt", async () => {
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "opaque-transactions-email-key-00000000",
    });
    const subject = randomUUID();
    const proof = verifiedAccountSignIn({
      issuer: "https://identity.example",
      subject,
      verifiedEmail: `${subject}@example.com`,
    });
    const created = await accounts.establishAccount({
      identity: proof.identity,
    });
    if (!created.ok) throw new Error("Account creation failed");
    const actor = created.account.accountId;
    await db.prisma.accountPermission.create({
      data: { accountId: actor, permission: "materials:manage" },
    });
    let revokeAfterRead = true;
    const { authoring } = assembleMaterials({
      prisma: db.prisma,
      authorPolicy: {
        async canManage(accountId, handle) {
          const decision = await accounts.checkPermission(
            { accountId, permission: "materials:manage" },
            handle,
          );
          if (revokeAfterRead && handle === undefined) {
            revokeAfterRead = false;
            await db.prisma.accountPermission.deleteMany({
              where: { accountId },
            });
          }
          return decision.ok && decision.allowed;
        },
      },
    });
    const command = {
      actor,
      idempotencyKey: randomUUID(),
      metadata: {
        title: null,
        summary: null,
        access: "free" as const,
        topicId: null,
        formatId: null,
        tagIds: [],
        difficulty: null,
        outcomes: [],
        seriesIds: [],
      },
      body: representativeDocument("An author mutation."),
    };
    expect(await authoring.createDraft(command)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    await db.prisma.accountPermission.create({
      data: { accountId: actor, permission: "materials:manage" },
    });
    expect(await authoring.createDraft(command)).toMatchObject({
      ok: true,
      value: { publicationState: "draft", contentVersion: 1 },
    });
  });
});
