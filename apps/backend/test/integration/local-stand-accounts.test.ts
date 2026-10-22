import { afterAll, beforeAll, expect, test } from "vitest";
import { seedLocalStandAccounts } from "../../src/development/seed-local-stand-accounts.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import { accountId } from "../../src/modules/accounts/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

test("local stand accounts keep identity, real permissions and learner access on repeated bootstrap", async () => {
  const input = {
    owner: "stand-owner",
    learner: "stand-learner",
    learnerWithAccess: "stand-learner-with-access",
  };
  const issuer = "https://identity.inside.localhost:3301/oidc";
  const clock = () => new Date("2030-01-01T00:00:00.000Z");
  const first = await seedLocalStandAccounts(
    database.prisma,
    issuer,
    input,
    clock,
  );
  expect(
    await seedLocalStandAccounts(database.prisma, issuer, input, clock),
  ).toEqual(first);
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: "local-test-email-key-at-least-32-characters",
  });
  for (const [key, id] of Object.entries(first)) {
    expect(
      await accounts.checkPermission({
        accountId: id,
        permission: "materials:manage",
      }),
    ).toEqual({ ok: true, allowed: key === "owner" });
  }
  const rights = assembleAccountRights({ prisma: database.prisma, clock });
  expect((await rights.resolveForAccess(accountId(first.owner))).kind).toBe(
    "active",
  );
  expect(
    (await rights.resolveForAccess(accountId(first.learnerWithAccess))).kind,
  ).toBe("active");
  expect((await rights.resolveForAccess(accountId(first.learner))).kind).toBe(
    "required",
  );
});
