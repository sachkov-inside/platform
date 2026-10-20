import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";

import {
  fullStackBrowserRequest,
  signInFullStack,
} from "../support/full-stack-session";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

test("cabinet presents private Telegram state and documents on one page", async ({
  context,
  page,
  request,
}) => {
  await signInFullStack(context, "OWNER");
  const response = await page.goto("/account");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Личный кабинет", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Почта", exact: true }),
  ).toContainText("fullstack-owner@inside.test");
  expect((await request.get("/api/account/email")).status()).toBe(401);
  expect(
    (
      await page.request.post("/api/account/email/start", {
        headers: { origin: "https://foreign.invalid" },
        multipart: { email: "unused@example.test" },
      })
    ).status(),
  ).toBe(403);
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

test("cabinet saves display name without a bio editor", async ({
  context,
  page,
}, info) => {
  const savedName = `Проверка профиля ${info.project.name}`;
  await signInFullStack(context, "MEMBER");
  await page.goto("/");
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  const before = await fullStackBrowserRequest(page, "/api/account/profile");
  expect(before.status()).toBe(200);
  const state = z.object({ state: z.unknown() }).parse(await before.json());
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Личный кабинет", exact: true }),
  ).toBeVisible();
  const name = page.getByRole("textbox", {
    name: "Отображаемое имя",
    exact: true,
  });
  await expect(name).toBeVisible();
  await name.fill(savedName);
  await page
    .getByRole("button", { name: "Сохранить имя", exact: true })
    .click();
  await expect(page.getByText("Имя сохранено.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /О себе/u })).toHaveCount(0);
  await expect(page.locator("[data-account-section-nav]")).toHaveCount(0);
  const after = await fullStackBrowserRequest(page, "/api/account/profile");
  expect(after.status()).toBe(200);
  const profileState = z
    .object({
      state: z.object({
        kind: z.literal("profile"),
        profile: z.object({
          displayName: z.string(),
          bio: z.string().nullable(),
          avatar: z.unknown(),
        }),
      }),
    })
    .parse(await after.json());
  expect(profileState.state.profile.displayName).toBe(savedName);
  const previous = z
    .object({
      state: z.union([
        z.object({ kind: z.literal("missing") }),
        z.object({
          kind: z.literal("profile"),
          profile: z.object({
            bio: z.string().nullable(),
            avatar: z.unknown(),
          }),
        }),
      ]),
    })
    .parse(state);
  expect(profileState.state.profile.bio).toBe(
    previous.state.kind === "profile" ? previous.state.profile.bio : null,
  );
  expect(profileState.state.profile.avatar).toEqual(
    previous.state.kind === "profile" ? previous.state.profile.avatar : null,
  );
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Отображаемое имя" }),
  ).toHaveValue(savedName);
  await expect(
    page.getByRole("region", { name: "Почта", exact: true }),
  ).toContainText("fullstack-member@inside.test");
  if (process.env["CAPTURE_EVIDENCE"] === "1") {
    await screenshotWholePage(page, {
      path: info.outputPath("account-profile.png"),
    });
  }
});
