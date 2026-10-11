import AxeBuilder from "@axe-core/playwright";

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

import { catalogOutcomeSchema } from "@/features/billing-admin/model/admin-operations";
import type { OfferEligibility } from "@/entities/subscription";

import {
  fullStackBrowserRequest,
  signInFullStack,
} from "../support/full-stack-session";

/** Only synthetic catalogue records in the disposable full-stack database; sale commands are intercepted. */
async function createTariff(
  page: Page,
  mode: "subscription" | "one_time",
  eligibility?: OfferEligibility,
) {
  const id = randomUUID();
  const name = `Допуск synthetic ${id}`;
  const saved = await fullStackBrowserRequest(
    page,
    "/api/authoring/billing/offers/save",
    "POST",
    {
      input: JSON.stringify({
        operationId: randomUUID(),
        value: {
          id,
          name,
          benefits: ["materials"],
          ...(eligibility === undefined ? {} : { eligibility }),
        },
      }),
    },
  );
  expect(await saved.json()).toMatchObject({ ok: true });
  const priced = await fullStackBrowserRequest(
    page,
    "/api/authoring/billing/payment-options/save",
    "POST",
    {
      input: JSON.stringify({
        operationId: randomUUID(),
        value: {
          id: randomUUID(),
          offerId: id,
          mode,
          months: 1,
          priceKopecks: 10_000,
        },
      }),
    },
  );
  expect(await priced.json()).toMatchObject({ ok: true });
  await page.reload();
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
        const form = await new Response(request.postData(), {
          headers: { "content-type": request.headers()["content-type"] ?? "" },
        }).formData();
        const raw = form.get("input");
        if (typeof raw !== "string")
          throw new Error("Sale command is missing its input");
        const input = saleCommandSchema.parse(JSON.parse(raw));
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

test("saved eligibility controls confirmation, cancellation, revision and reload", async ({
  browser,
  context,
  page,
}) => {
  await signInFullStack(context, "OWNER");
  await page.goto("/authoring/access");
  const commands = await interceptSale(page);
  const tariff = await createTariff(page, "subscription");
  const select = tariff.row.getByLabel("Кому продаётся");
  const enable = tariff.row.getByRole("button", {
    name: "Включить продажу",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Включить продажу подписки всем?",
  });
  await expect(select).toHaveValue("everyone");
  await select.selectOption("invitation_only");
  await enable.click();
  await expect(dialog.getByRole("button", { name: "Отмена" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Включить продажу всем" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Отмена" })).toBeFocused();
  const accessibility = await new AxeBuilder({ page })
    .include("dialog")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: window.innerWidth,
      height: window.innerHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(enable).toBeFocused();
  expect(commands).toEqual([]);
  await enable.click();
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(enable).toBeFocused();
  expect(commands).toEqual([]);

  const saveResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/authoring/billing/offers/save"),
  );
  await tariff.row.getByRole("button", { name: "Сохранить допуск" }).click();
  const saved = z
    .object({ ok: z.literal(true), value: catalogOutcomeSchema })
    .parse(await (await saveResponse).json());
  const invitationRevision = saved.value.result.value.revision;
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "продаётся только по приглашению" }),
  ).toBeVisible();

  const reopened = await browser.newContext();
  try {
    await signInFullStack(reopened, "OWNER");
    const reopenedPage = await reopened.newPage();
    await reopenedPage.goto("/authoring/access");
    await expect(
      reopenedPage
        .getByRole("listitem", { name: tariff.name, exact: true })
        .getByLabel("Кому продаётся"),
    ).toHaveValue("invitation_only");
  } finally {
    await reopened.close();
  }

  // Unsaved everyone cannot override the persisted invitation or the returned revision.
  await select.selectOption("everyone");
  await enable.click();
  await expect(
    tariff.row.getByText("Продаётся", { exact: true }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(commands).toEqual([
    { id: tariff.id, expectedRevision: invitationRevision, published: true },
  ]);
  // Publication was synthetic; the database still holds the saved invitation and an unpublished tariff.
  await page.reload();
  await expect(select).toHaveValue("invitation_only");
  await expect(
    tariff.row.getByText("Не продаётся", { exact: true }),
  ).toBeVisible();
  await select.selectOption("everyone");
  const everyoneResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/authoring/billing/offers/save"),
  );
  await tariff.row.getByRole("button", { name: "Сохранить допуск" }).click();
  const everyoneSaved = z
    .object({ ok: z.literal(true), value: catalogOutcomeSchema })
    .parse(await (await everyoneResponse).json());
  const everyoneRevision = everyoneSaved.value.result.value.revision;
  await expect(
    page.getByRole("status").filter({ hasText: "допуск сохранён" }),
  ).toBeVisible();
  await page.reload();
  await expect(select).toHaveValue("everyone");
  await enable.click();
  await expect(dialog).toBeVisible();
  expect(commands).toHaveLength(1);
  await dialog
    .getByRole("button", { name: "Включить продажу всем" })
    .dblclick();
  await expect(
    tariff.row.getByText("Продаётся", { exact: true }),
  ).toBeVisible();
  expect(commands).toEqual([
    { id: tariff.id, expectedRevision: invitationRevision, published: true },
    { id: tariff.id, expectedRevision: everyoneRevision, published: true },
  ]);
  await tariff.row.getByRole("button", { name: "Снять с продажи" }).click();
  await expect(
    tariff.row.getByText("Не продаётся", { exact: true }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(commands.at(-1)).toEqual({
    id: tariff.id,
    expectedRevision: everyoneRevision + 1,
    published: false,
  });
});

for (const [mode, eligibility] of [
  ["subscription", "invitation_only"],
  ["subscription", "former_tribute_subscribers"],
  ["one_time", "everyone"],
] as const) {
  test(`sale ${mode}/${eligibility} has no extra subscription warning`, async ({
    context,
    page,
  }) => {
    await signInFullStack(context, "OWNER");
    await page.goto("/authoring/access");
    const commands = await interceptSale(page);
    const tariff = await createTariff(page, mode, eligibility);
    await tariff.row
      .getByRole("button", { name: "Включить продажу", exact: true })
      .click();
    await expect(
      tariff.row.getByText("Продаётся", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Включить продажу подписки всем?" }),
    ).toHaveCount(0);
    expect(commands).toEqual([
      { id: tariff.id, expectedRevision: 1, published: true },
    ]);
  });
}
