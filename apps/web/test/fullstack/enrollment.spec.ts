import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  fullStackBrowserRequest,
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
  // The person card BFF is the owner's read of Product Access (#1721); the list and read
  // commands of the former access tab are gone.
  const cardSchema = z.object({
    kind: z.literal("ready"),
    card: z.object({
      products: z.object({
        state: z.literal("ready"),
        items: z.array(
          z.object({
            productId: z.string(),
            access: z.enum(["active", "revoked"]),
            revision: z.int(),
            firstIssuedAt: z.iso.datetime({ offset: true }).nullable(),
            history: z.array(z.object({ kind: z.string() })),
          }),
        ),
      }),
    }),
  });
  async function read() {
    const response = await fullStackBrowserRequest(
      page,
      `/api/authoring/people/${pair.accountId}`,
    );
    expect(response.status()).toBe(200);
    const product = cardSchema
      .parse(await response.json())
      .card.products.items.find((item) => item.productId === pair.productId);
    if (product === undefined) throw new Error("The card has no such Product");
    return product;
  }
  await page.goto(`/authoring/people/${owner}`);
  const card = page.getByRole("main");
  const product = card.locator(`[data-person-product="${productId}"]`);
  async function grant(reason: string) {
    await card
      .getByRole("button", { name: "Выдать продукт", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Выдать продукт" });
    await dialog
      .locator(`input[type="radio"][value="${pair.productId}"]`)
      .check();
    if (await dialog.getByRole("radio", { name: reason }).isVisible())
      await dialog.getByRole("radio", { name: reason }).check();
    return dialog;
  }
  const issueDialog = await grant("Подарок");
  await issueDialog
    .getByRole("button", { name: "Выдать продукт", exact: true })
    .click();
  await expect(card.getByText(/^Доступ выдан\.$|уже был/u)).toBeVisible();
  const issued = await read();
  expect(issued.access).toBe("active");
  const cabinet = await context.newPage();
  await cabinet.goto("/account");
  const cookieNotice = cabinet.getByRole("button", {
    name: "Понятно",
    exact: true,
  });
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  const cabinetCard = cabinet.locator(`[data-account-product="${productId}"]`);
  await expect(
    cabinetCard.getByRole("heading", {
      name: "Инженерная практика",
      exact: true,
    }),
  ).toBeVisible();
  // A second grant of an active Product changes nothing, the dialog says so before sending.
  const repeat = await grant("Компенсация или решение поддержки");
  await expect(repeat.getByText(/Выдача ничего не изменит/u)).toBeVisible();
  await repeat
    .getByRole("button", { name: "Выдать продукт", exact: true })
    .click();
  await expect(card.getByText(/ничего не изменилось/u)).toBeVisible();
  const repeated = await read();
  expect(repeated.firstIssuedAt).toBe(issued.firstIssuedAt);
  await product.getByRole("button", { name: /^Отозвать доступ к/u }).click();
  const revoke = page.getByRole("dialog", { name: /^Отозвать доступ к/u });
  await expect(revoke.getByText("Материалы продукта закроются.")).toBeVisible();
  await revoke.getByRole("radio", { name: "Другое" }).check();
  await revoke.getByLabel("Заметка").fill("Синтетический отзыв Product");
  await revoke
    .getByRole("button", { name: "Отозвать доступ", exact: true })
    .click();
  await expect(card.getByText(/^Доступ к «.+» отозван\.$/u)).toBeVisible();
  const withdrawn = await read();
  expect(withdrawn.access).toBe("revoked");
  await cabinet.reload();
  await expect(
    cabinetCard.getByText("Доступ отозван", { exact: true }),
  ).toBeVisible();
  // A grant cannot silently undo withdrawal: the dialog sends the owner to restoration.
  const regrant = await grant("Подарок");
  await expect(regrant.getByText(/Выдача его не вернёт/u)).toBeVisible();
  await regrant
    .getByRole("button", { name: "Перейти к восстановлению", exact: true })
    .click();
  const restore = page.getByRole("dialog", { name: /^Восстановить доступ к/u });
  await restore
    .getByLabel("Причина")
    .fill("Явное синтетическое решение владельца");
  await restore
    .getByRole("button", { name: "Восстановить доступ", exact: true })
    .click();
  await expect(card.getByText(/восстановлен\.$/u)).toBeVisible();
  const restored = await read();
  expect(restored.access).toBe("active");
  expect(restored.firstIssuedAt).toBe(issued.firstIssuedAt);
  expect(restored.history.map((entry) => entry.kind)).toEqual(
    expect.arrayContaining(["revoke", "restore"]),
  );
  await cabinet.reload();
  await expect(
    cabinetCard.getByRole("heading", {
      name: "Инженерная практика",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    cabinetCard.getByText("Доступ отозван", { exact: true }),
  ).toHaveCount(0);
  if (process.env["CAPTURE_EVIDENCE"] === "1") {
    await page.locator("main").focus();
    await screenshotWholePage(page, {
      path: info.outputPath("owner-product-access.png"),
    });
  }
  // Activation Rule now binds directly to Product and a separate Course source.
  await page.goto(`/authoring/products/${productId}?tab=community`);
  const rules = page.getByRole("region", {
    name: "Активация прежнего курса",
    exact: true,
  });
  const ruleName = `Правило ${info.project.name}`;
  await rules.getByLabel("Название правила").fill(ruleName);
  await rules.getByLabel("Код активации").fill(randomUUID());
  await rules
    .getByLabel("Источник курса")
    .fill(`synthetic-course-${info.project.name}`);
  await rules
    .getByLabel("Причина", { exact: true })
    .fill("Синтетическая привязка курса к Product");
  await rules.getByLabel("Опубликовать сразу").check();
  await rules
    .getByRole("button", { name: "Создать правило", exact: true })
    .click();
  await expect(
    rules
      .getByRole("list", { name: "Правила активации продукта" })
      .getByRole("listitem")
      .filter({ hasText: ruleName }),
  ).toContainText("Опубликовано");
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
