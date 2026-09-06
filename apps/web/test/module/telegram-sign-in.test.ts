import { createServer, type Server } from "node:http";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  telegramSignInPage,
  telegramSignInScript,
  type InsideTelegramPresentation,
} from "../../../../infra/identity/logto/fork/packages/core/src/routes/inside-telegram-view";

let browser: Browser;
let server: Server;
let origin: string;
let state: InsideTelegramPresentation;
let offline = false;
let requests = 0;
const botLink = "https://t.me/inside_fixture_bot?start=test-only";
const evidence = fileURLToPath(new URL("../../../../docs/evidence/issue-303/", import.meta.url));

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/api/inside-telegram") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(telegramSignInPage);
    } else if (request.url === "/api/inside-telegram/script") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(telegramSignInScript);
    } else if (request.url === "/api/inside-telegram/status") {
      requests += 1;
      response.setHeader("Content-Type", "application/json");
      response.statusCode = offline ? 503 : 200;
      response.end(JSON.stringify(state));
    } else {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end("<title>Fixture destination</title><h1>Возврат ко входу или callback</h1>");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind");
  origin = `http://127.0.0.1:${String(address.port)}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve, reject) => server?.close((error) => { if (error) reject(error); else resolve(); }));
});

async function open(page: Page, status: InsideTelegramPresentation["status"]) {
  offline = false;
  requests = 0;
  state = { status, deepLink: botLink };
  await page.goto(`${origin}/api/inside-telegram`);
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent !== "Готовим вход…");
  await page.evaluate(() => document.fonts.ready);
}

it("renders every production state without overflow or accessibility violations on desktop and narrow mobile", async () => {
  const statuses = ["pending", "approved", "denied", "expired", "consumed", "disabled", "unavailable"] as const;
  for (const width of [1440, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    for (const status of statuses) {
      await open(page, status);
      expect(await page.locator("h1").textContent()).toBe("Вход через Telegram");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
      if (status === "pending") {
        expect(await page.locator("a").count()).toBe(1);
        expect(await page.locator("#bot").getAttribute("href")).toBe(botLink);
      } else if (status !== "approved") {
        expect(await page.locator("#bot").count()).toBe(0);
        expect(await page.locator("#alternative").getAttribute("href")).toBe("/sign-in");
      }
      if (process.env.CAPTURE_TELEGRAM_EVIDENCE === "1") {
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: `${evidence}/${status}-${String(width)}.png`, fullPage: true });
      }
    }
    await context.close();
  }
}, 60000);

it("keeps keyboard focus and control geometry across polls, reconnects, and returns from decline", async () => {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.clock.install();
  await open(page, "pending");
  await page.keyboard.press("Tab");
  const bounds = await page.locator("#bot").boundingBox();
  expect(await page.locator("#bot").evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  await page.clock.runFor(1600);
  expect(await page.locator("#bot").evaluate((element) => element === document.activeElement)).toBe(true);
  expect(await page.locator("#bot").boundingBox()).toEqual(bounds);
  offline = true;
  await page.clock.runFor(1600);
  await page.getByRole("status").filter({ hasText: "Нет связи" }).waitFor();
  expect(await page.locator("#bot").evaluate((element) => element === document.activeElement)).toBe(true);
  offline = false;
  state = { status: "denied" };
  await page.clock.runFor(1600);
  await page.locator("#alternative").waitFor();
  expect(await page.locator("#alternative").evaluate((element) => element === document.activeElement)).toBe(true);
  const stoppedAt = requests;
  await page.clock.runFor(5000);
  expect(requests).toBe(stoppedAt);
  await page.keyboard.press("Enter");
  await page.waitForURL(`${origin}/sign-in`);
  await page.close();
});

it("automatically completes in the original tab after approval and respects reduced motion", async () => {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.clock.install();
  await open(page, "pending");
  state = { status: "approved", callback: `${origin}/callback?fixture=approved` };
  await page.clock.runFor(1600);
  await page.waitForURL(`${origin}/callback?fixture=approved`);
  await open(page, "approved");
  expect(await page.locator(".inside-telegram-progress").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.close();
});
