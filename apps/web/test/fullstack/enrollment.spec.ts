import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  fullStackBrowserJsonRequest,
  signInFullStack,
} from "../support/full-stack-session";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

test("owner issues, withdraws and explicitly restores one Product right through real BFF and PostgreSQL", async ({
  page,
  context,
}, info) => {
  await signInFullStack(context, "OWNER");
  const owner = process.env["ENROLLMENT_OWNER_ID"];
  const productId = process.env["ENROLLMENT_PRODUCT_ID"];
  if (
    owner === undefined ||
    owner === "" ||
    productId === undefined ||
    productId === ""
  )
    throw new Error("Missing Product access owner fixture");
  const pair = { accountId: owner, productId };
  const stateSchema = z.object({
    ok: z.literal(true),
    value: z.object({
      value: z.object({
        access: z.enum(["active", "revoked"]),
        revision: z.int(),
        firstIssuedAt: z.iso.datetime().nullable(),
        sources: z.array(z.object({ sourceRef: z.string() })),
        actions: z.array(z.object({ kind: z.string() })),
      }),
    }),
  });
  async function read() {
    const response = await fullStackBrowserJsonRequest(
      page,
      "/api/authoring/access/products/read",
      "POST",
      pair,
    );
    expect(response.status()).toBe(200);
    return stateSchema.parse(await response.json()).value.value;
  }
  await page.goto("/authoring/access");
  const section = page
    .getByRole("heading", { name: "Доступ к продуктам", exact: true })
    .locator("..");
  await section.getByLabel("Account", { exact: true }).fill(owner);
  await section.getByLabel("Продукт", { exact: true }).fill(productId);
  const sourceRef = `synthetic-owner-${info.project.name}`;
  await section.getByLabel("Основание выдачи").fill(sourceRef);
  await section
    .getByLabel("Причина выдачи")
    .fill("Синтетическая ручная выдача Product");
  await section
    .getByRole("button", { name: "Выдать бессрочный доступ", exact: true })
    .click();
  await expect(section.getByRole("status")).toHaveText(
    "Бессрочное право сохранено.",
  );
  const issued = await read();
  expect(issued.access).toBe("active");
  expect(
    issued.sources.filter((source) => source.sourceRef === sourceRef),
  ).toHaveLength(1);
  const cabinet = await context.newPage();
  await cabinet.goto("/account");
  const cookieNotice = cabinet.getByRole("button", {
    name: "Понятно",
    exact: true,
  });
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  const card = cabinet.locator(`[data-account-product="${productId}"]`);
  await expect(
    card.getByRole("heading", { name: "Инженерная практика", exact: true }),
  ).toBeVisible();
  // Repeating the same source preserves the first issuance and the source history.
  await section
    .getByRole("button", { name: "Выдать бессрочный доступ", exact: true })
    .click();
  await expect(
    section.getByRole("button", {
      name: "Выдать бессрочный доступ",
      exact: true,
    }),
  ).toBeEnabled();
  const repeated = await read();
  expect(repeated.firstIssuedAt).toBe(issued.firstIssuedAt);
  expect(
    repeated.sources.filter((source) => source.sourceRef === sourceRef),
  ).toHaveLength(1);
  const revoke = section.getByRole("region", {
    name: `Отзыв доступа к продукту для Account ${owner}`,
    exact: true,
  });
  await revoke
    .getByRole("combobox", { name: "Продукт", exact: true })
    .selectOption(productId);
  await revoke
    .getByRole("button", { name: "Проверить доступ", exact: true })
    .click();
  await revoke
    .getByLabel("Причина", { exact: true })
    .fill("Синтетический отзыв Product");
  await revoke
    .getByRole("button", { name: "Отозвать доступ к продукту", exact: true })
    .click();
  await expect(revoke.getByRole("status")).toContainText(
    "Доступ к продукту отозван",
  );
  const withdrawn = await read();
  expect(withdrawn.access).toBe("revoked");
  await cabinet.reload();
  await expect(card.getByText("Доступ отозван", { exact: true })).toBeVisible();
  // Another source cannot silently undo withdrawal.
  await section.getByLabel("Основание выдачи").fill(`${sourceRef}-other`);
  await section
    .getByRole("button", { name: "Выдать бессрочный доступ", exact: true })
    .click();
  await expect(
    section.getByText(
      "Доступ отозван. Для возврата права используйте явное восстановление.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await read()).access).toBe("revoked");
  await section
    .getByLabel("Причина восстановления")
    .fill("Явное синтетическое решение владельца");
  await section
    .getByRole("button", { name: "Явно восстановить доступ", exact: true })
    .click();
  await expect(
    section.getByText("Доступ явно восстановлен владельцем.", { exact: true }),
  ).toBeVisible();
  const restored = await read();
  expect(restored.access).toBe("active");
  expect(restored.firstIssuedAt).toBe(issued.firstIssuedAt);
  expect(restored.actions.map((action) => action.kind)).toEqual(
    expect.arrayContaining(["revoke", "restore"]),
  );
  await cabinet.reload();
  await expect(
    card.getByRole("heading", { name: "Инженерная практика", exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Доступ отозван", { exact: true })).toHaveCount(
    0,
  );
  if (process.env["CAPTURE_EVIDENCE"] === "1") {
    await page.locator("main").focus();
    await screenshotWholePage(page, {
      path: info.outputPath("owner-product-access.png"),
    });
  }
  // Activation Rule now binds directly to Product and a separate Course source.
  await page.goto("/authoring/billing");
  await page.getByRole("tab", { name: "Активация курса", exact: true }).click();
  const rules = page
    .getByRole("heading", { name: "Ссылки активации курса", exact: true })
    .locator("..");
  await rules.getByLabel("Идентификатор нового правила").fill(randomUUID());
  const ruleName = `Правило ${info.project.name}`;
  await rules.getByLabel("Название правила").fill(ruleName);
  await rules.getByLabel("Код активации").fill(randomUUID());
  await rules.getByLabel("Идентификатор продукта").fill(productId);
  await rules
    .getByLabel("Подтверждаемый источник курса")
    .fill(`synthetic-course-${info.project.name}`);
  await rules
    .getByLabel("Причина", { exact: true })
    .fill("Синтетическая привязка курса к Product");
  await rules.getByLabel("Опубликовать правило").check();
  await rules
    .getByRole("button", { name: "Создать правило", exact: true })
    .click();
  await expect(
    rules.getByText(`${ruleName} · Опубликовано`, { exact: true }),
  ).toBeVisible();
  for (const surface of [page, cabinet]) {
    const scan = await new AxeBuilder({ page: surface })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      scan.violations.filter(
        (item) => item.impact === "serious" || item.impact === "critical",
      ),
    ).toEqual([]);
    expect(
      await surface.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  if (process.env["CAPTURE_EVIDENCE"] === "1") {
    await cabinet.locator("main").focus();
    await screenshotWholePage(cabinet, {
      path: info.outputPath("cabinet-product-access.png"),
    });
    await page.locator("main").focus();
    await screenshotWholePage(page, {
      path: info.outputPath("owner-course-activation.png"),
    });
  }
  await cabinet.close();
});
