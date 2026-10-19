import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";

import {
  fullStackBrowserRequest,
  signInFullStack,
} from "../support/full-stack-session";

test("cabinet presents private Telegram state and documents on one page", async ({
  context,
  page,
}) => {
  await signInFullStack(context, "OWNER");
  const response = await page.goto("/account");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Личный кабинет", exact: true }),
  ).toBeVisible();
  const telegram = page.getByRole("region", { name: "Telegram", exact: true });
  await expect(
    telegram.getByRole("button", { name: "Подключить", exact: true }),
  ).toBeVisible();
  await expect(telegram).not.toContainText(
    /accountId|checkedAt|issuer|subject|telegramIdentity/u,
  );
  await page.getByText("Документы", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Принятые документы" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Выйти из аккаунта" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  expect(
    await page
      .locator("html")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
});

test("simplified cabinet preserves private profile data without profile editing UI", async ({
  context,
  page,
}) => {
  await signInFullStack(context, "MEMBER");
  await page.goto("/");
  const before = await fullStackBrowserRequest(page, "/api/account/profile");
  expect(before.status()).toBe(200);
  const state = z.object({ state: z.unknown() }).parse(await before.json());
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Личный кабинет", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Имя", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /О себе/u })).toHaveCount(0);
  await expect(page.locator("[data-account-section-nav]")).toHaveCount(0);
  const after = await fullStackBrowserRequest(page, "/api/account/profile");
  expect(after.status()).toBe(200);
  expect(z.object({ state: z.unknown() }).parse(await after.json())).toEqual(
    state,
  );
});
