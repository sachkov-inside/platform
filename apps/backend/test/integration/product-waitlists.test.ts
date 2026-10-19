import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ProductWaitlists } from "../../src/modules/sales-funnel/facets/product-waitlists/product-waitlists.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let db: TestDatabase;
let waitlists: ProductWaitlists;
const accountId = randomUUID();
const productId = randomUUID();
const intakeId = randomUUID();
beforeAll(async () => {
  db = await createMigratedTestDatabase();
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://waitlist.test",
      logtoSubject: accountId,
    },
  });
  await db.prisma.product.create({
    data: {
      id: productId,
      slug: "ai-engineering",
      name: "AI Engineering",
      summary: "",
    },
  });
  await db.prisma.productWaitlistIntake.create({
    data: { id: intakeId, productId, name: "Следующий набор", accepting: true },
  });
  await db.prisma.telegramAccountLinkState.create({
    data: {
      accountId,
      linkRef: randomUUID(),
      revision: 1,
      principalRef: "principal-test",
      identityRef: "identity-test",
      updatedAt: new Date("2030-03-01T00:00:00Z"),
    },
  });
  waitlists = new ProductWaitlists({
    prisma: db.prisma,
    links: new TelegramAccountLinks(db.prisma),
    clock: () => new Date("2030-03-05T12:00:00Z"),
  });
});
afterAll(async () => {
  await db.dispose();
});

test("explicit concurrent joins converge on one active membership for one intake", async () => {
  expect(await waitlists.read(accountId, productId)).toMatchObject({
    ok: true,
    value: { intakeId, active: false },
  });
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      waitlists.join(accountId, {
        intakeId,
        operationId: randomUUID(),
        source: "youtube",
      }),
    ),
  );
  expect(results.every((result) => result.ok)).toBe(true);
  expect(await waitlists.read(accountId, productId)).toMatchObject({
    ok: true,
    value: { intakeId, active: true },
  });
  expect(
    await waitlists.demand({
      productId,
      from: new Date("2030-03-01Z"),
      to: new Date("2030-04-01Z"),
    }),
  ).toMatchObject({
    ok: true,
    value: {
      intakeId,
      active: 1,
      joined: 1,
      withdrawn: 0,
      sources: [{ source: "youtube", active: 1, joined: 1, withdrawn: 0 }],
    },
  });
});

test("withdrawal and rejoin change stock once and retain distinct period events without granting access", async () => {
  expect(await waitlists.withdraw(accountId, { intakeId })).toMatchObject({
    ok: true,
    value: { active: false },
  });
  expect(await waitlists.withdraw(accountId, { intakeId })).toMatchObject({
    ok: true,
    value: { active: false },
  });
  expect(
    await waitlists.demand({
      productId,
      from: new Date("2030-03-01Z"),
      to: new Date("2030-04-01Z"),
    }),
  ).toMatchObject({ ok: true, value: { active: 0, joined: 1, withdrawn: 1 } });
  expect(
    await waitlists.join(accountId, {
      intakeId,
      operationId: randomUUID(),
      source: null,
    }),
  ).toMatchObject({ ok: true, value: { active: true } });
  expect(
    await waitlists.demand({
      productId,
      from: new Date("2030-03-01Z"),
      to: new Date("2030-04-01Z"),
    }),
  ).toMatchObject({
    ok: true,
    value: {
      active: 1,
      joined: 2,
      withdrawn: 1,
      sources: [
        { source: "youtube", active: 0, joined: 1, withdrawn: 1 },
        { source: null, active: 1, joined: 1, withdrawn: 0 },
      ],
    },
  });
});

test("an Account without a current Telegram binding cannot join; intake identity separates future demand", async () => {
  const emailId = randomUUID();
  await db.prisma.account.create({
    data: {
      id: emailId,
      logtoIssuer: "https://waitlist.test",
      logtoSubject: emailId,
    },
  });
  expect(
    await waitlists.join(emailId, {
      intakeId,
      operationId: randomUUID(),
      source: null,
    }),
  ).toEqual({ ok: false, error: { code: "telegram_required" } });
  expect(await waitlists.read(emailId, productId)).toMatchObject({
    ok: true,
    value: { active: false },
  });
  const futureId = randomUUID();
  await db.prisma.productWaitlistIntake.update({
    where: { id: intakeId },
    data: { accepting: false, name: "Previous intake" },
  });
  await db.prisma.productWaitlistIntake.create({
    data: { id: futureId, productId, name: "Future intake", accepting: true },
  });
  expect(await waitlists.read(accountId, productId)).toMatchObject({
    ok: true,
    value: { intakeId: futureId, active: false },
  });
  expect(
    await waitlists.join(accountId, {
      intakeId,
      operationId: randomUUID(),
      source: null,
    }),
  ).toEqual({ ok: false, error: { code: "intake_not_found" } });
  expect(
    await waitlists.join(accountId, {
      intakeId: futureId,
      operationId: randomUUID(),
      source: null,
    }),
  ).toMatchObject({ ok: true, value: { intakeId: futureId, active: true } });
  expect(
    await waitlists.demand({
      productId,
      from: new Date("2030-03-01Z"),
      to: new Date("2030-04-01Z"),
    }),
  ).toMatchObject({
    ok: true,
    value: { intakeId: futureId, active: 1, joined: 1, withdrawn: 0 },
  });
});

test("a completed join intent cannot re-enrol after withdrawal or act for another Account", async () => {
  const current = await waitlists.read(accountId, productId);
  if (!current.ok) throw new Error("Current intake required");
  const command = {
    intakeId: current.value.intakeId,
    operationId: randomUUID(),
    source: "channel",
  };
  expect(await waitlists.join(accountId, command)).toMatchObject({
    ok: true,
    value: { active: true },
  });
  await waitlists.withdraw(accountId, { intakeId: current.value.intakeId });
  expect(await waitlists.join(accountId, command)).toMatchObject({
    ok: true,
    value: { active: false },
  });
});
