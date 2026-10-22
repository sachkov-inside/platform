import AxeBuilder from "@axe-core/playwright";

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

import { catalogOutcomeSchema } from "@/features/billing-admin/model/admin-operations";

import {
  fullStackBrowserJsonRequest,
  signInFullStack,
} from "../support/full-stack-session";

/** Only synthetic catalogue records in the disposable full-stack database; sale commands are intercepted. */
async function createTariff(page: Page) {
  const id = randomUUID();
  const name = `Допуск synthetic ${id}`;
  const saved = await fullStackBrowserJsonRequest(
    page,
    "/api/authoring/billing/offers/save",
    "POST",
    {
      operationId: randomUUID(),
      value: {
        id,
        name,
        benefits: [`product:${randomUUID()}`],
      },
    },
  );
  expect(await saved.json()).toMatchObject({ ok: true });
  const priced = await fullStackBrowserJsonRequest(
    page,
    "/api/authoring/billing/payment-options/save",
    "POST",
    {
      operationId: randomUUID(),
      value: {
        id: randomUUID(),
        offerId: id,
        mode: "one_time",
        months: 1,
        priceKopecks: 10_000,
      },
    },
  );
  expect(await priced.json()).toMatchObject({ ok: true });
  await page.reload();
  await page.getByRole("tab", { name: "Тарифы", exact: true }).click();
  return { id, name, row: page.getByRole("listitem", { name, exact: true }) };
}
const saleCommandSchema = z.object({
  operationId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.int().positive(),
});

async function interceptSale(page: Page) {
  const commands: {
    id: string;
    expectedRevision: number;
    published: boolean;
  }[] = [];
  for (const published of [true, false]) {
    const operation = published ? "publish" : "unpublish";
    await page.route(
      `**/api/authoring/billing/offers/${operation}`,
      async (route) => {
        const request = route.request();
        const input = saleCommandSchema.parse(request.postDataJSON());
        commands.push({
          id: input.id,
          expectedRevision: input.expectedRevision,
          published,
        });
        await route.fulfill({
          json: {
            ok: true,
            value: {
              operationRef: input.operationId,
              result: {
                outcome: "catalog",
                value: {
                  id: input.id,
                  revision: input.expectedRevision + 1,
                  archived: false,
                  published,
                },
              },
            },
          },
        });
      },
    );
  }
  return commands;
}

test("one-time product sale keeps saved eligibility and revision across reload", async ({
  context,
  page,
}, testInfo) => {
  await signInFullStack(context, "OWNER");
  await page.goto("/authoring/access");
  const commands = await interceptSale(page);
  const tariff = await createTariff(page);
  const select = tariff.row.getByLabel("Кому продаётся");
  await expect(select).toHaveValue("everyone");
  await select.selectOption("invitation_only");
  const saveResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/authoring/billing/offers/save"),
  );
  await tariff.row.getByRole("button", { name: "Сохранить допуск" }).click();
  const saved = z
    .object({ ok: z.literal(true), value: catalogOutcomeSchema })
    .parse(await (await saveResponse).json());
  const revision = saved.value.result.value.revision;
  await page.reload();
  await page.getByRole("tab", { name: "Тарифы", exact: true }).click();
  await expect(select).toHaveValue("invitation_only");
  // Unsaved eligibility does not replace the persisted setting or revision.
  await select.selectOption("everyone");
  await tariff.row
    .getByRole("button", { name: "Включить продажу", exact: true })
    .click();
  await expect(
    tariff.row.getByText("Продаётся", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(commands).toEqual([
    { id: tariff.id, expectedRevision: revision, published: true },
  ]);
  await tariff.row.getByRole("button", { name: "Снять с продажи" }).click();
  await expect(
    tariff.row.getByText("Не продаётся", { exact: true }),
  ).toBeVisible();
  expect(commands.at(-1)).toEqual({
    id: tariff.id,
    expectedRevision: revision + 1,
    published: false,
  });
  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(
    scan.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  await testInfo.attach("one-time-product-sale", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("current runtime refuses a subscription option through the real API", async ({
  context,
  page,
}) => {
  await signInFullStack(context, "OWNER");
  await page.goto("/authoring/access");
  const tariff = await createTariff(page);
  const response = await fullStackBrowserJsonRequest(
    page,
    "/api/authoring/billing/payment-options/save",
    "POST",
    {
      operationId: randomUUID(),
      value: {
        id: randomUUID(),
        offerId: tariff.id,
        mode: "subscription",
        months: 1,
        priceKopecks: 10_000,
      },
    },
  );
  expect(await response.json()).toMatchObject({
    ok: false,
    code: "method_unavailable",
  });
  await page.getByRole("tab", { name: "Приглашения", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Выданные приглашения", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Новое приглашение", exact: true }),
  ).toHaveCount(0);
});
