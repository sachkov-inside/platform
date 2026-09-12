import { createServer, type Server } from "node:http";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  pollIntervalMilliseconds,
  telegramSignInPage,
  telegramSignInScript,
  type InsideTelegramPresentation,
} from "../../../../infra/identity/logto/fork/packages/core/src/routes/inside-telegram-view";
import { evidenceDirectory } from "../../../../scripts/evidence-path.mjs";

let browser: Browser;
let server: Server;
let origin: string;
let fixtureOrigin: string;
let state: InsideTelegramPresentation;
let offline = false;
let requests = 0;
let stalledStatus: "headers" | "body" | undefined;
const botLink = "https://t.me/inside_fixture_bot?start=test-only";
const evidence = evidenceDirectory("issue-303");

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
      if (stalledStatus) {
        const stage = stalledStatus;
        stalledStatus = undefined;
        if (stage === "body") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.write("{");
        }
        return;
      }
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
  fixtureOrigin = `http://127.0.0.1:${String(address.port)}`;
  origin = process.env.TELEGRAM_UI_ORIGIN ?? fixtureOrigin;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve, reject) => server?.close((error) => { if (error) reject(error); else resolve(); }));
});

// One step of the virtual clock lands just past the page's own polling interval, so the poll timer
// is due; `severalPollsMs` covers enough intervals to show that polling continued or stopped.
const clockStepMs = pollIntervalMilliseconds + 100;
const severalPollsMs = pollIntervalMilliseconds * 3;

// runFor returns once the virtual timers have run, not once the request they started was answered:
// the answer travels over a real socket. Waiting for the answer is the fact; the clock is only the trigger.
async function poll(page: Page) {
  const answered = page.waitForResponse((response) => response.url().endsWith("/api/inside-telegram/status"));
  await page.clock.runFor(clockStepMs);
  await answered;
}

// Reading the focused element by id in one evaluation. Resolving a locator and evaluating on it are
// two round trips, and a re-render between them detaches the resolved node, which never equals
// document.activeElement however correct the page is.
const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id);

async function open(page: Page, status: InsideTelegramPresentation["status"]) {
  offline = false;
  requests = 0;
  state = { status, deepLink: botLink };
  if (process.env.TELEGRAM_UI_ORIGIN) {
    await page.unrouteAll();
    await page.route(`${origin}/api/inside-telegram/status`, async (route) => {
      requests += 1;
      await route.fulfill({ status: offline ? 503 : 200, json: state });
    });
  }
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
        await page.screenshot({ path: `${evidence}/${process.env.TELEGRAM_UI_ORIGIN ? "logto-" : ""}${status}-${String(width)}.png`, fullPage: true });
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
  await poll(page);
  expect(await focusedId(page)).toBe("bot");
  expect(await page.locator("#bot").boundingBox()).toEqual(bounds);
  offline = true;
  await poll(page);
  await page.getByRole("status").filter({ hasText: "Нет связи" }).waitFor();
  expect(await focusedId(page)).toBe("alternative");
  offline = false;
  state = { status: "denied" };
  await poll(page);
  // The rendered decline is the fact. #alternative is already on screen from the reconnecting state,
  // so waiting for it would only wait for the previous render and read focus mid-replacement.
  await page.getByRole("status").filter({ hasText: "Вы отменили вход" }).waitFor();
  expect(await focusedId(page)).toBe("alternative");
  const stoppedAt = requests;
  // Proving that nothing happens is the one wait a duration can settle: the clock is virtual, the
  // decline above is already applied, and no timer is left to fire inside three polling intervals.
  await page.clock.runFor(severalPollsMs);
  expect(requests).toBe(stoppedAt);
  // The visual fixture has no Logto interaction; assert the return destination without starting auth.
  await page.route(`${origin}/sign-in`, async (route) => {
    await route.fulfill({ contentType: "text/html", body: "<h1>Sign-in fixture</h1>" });
  });
  await page.keyboard.press("Enter");
  await page.waitForURL(`${origin}/sign-in`);
  await page.close();
});

it("automatically completes in the original tab after approval and respects reduced motion", async () => {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.clock.install();
  await open(page, "pending");
  state = { status: "approved", callback: `${origin}/callback?fixture=approved` };
  await page.clock.runFor(clockStepMs);
  await page.waitForURL(`${origin}/callback?fixture=approved`);
  await open(page, "approved");
  expect(await page.locator(".inside-telegram-progress").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.close();
});

it("offers a keyboard-accessible return during persistent connection failure, including the first poll", async () => {
  const page = await browser.newPage();
  await page.clock.install();
  let refused = 0;
  await page.route(`${origin}/api/inside-telegram/status`, async (route) => {
    refused += 1;
    await route.fulfill({ status: 503, body: "Service unavailable" });
  });
  await page.goto(`${origin}/api/inside-telegram`);
  await page.getByRole("status").filter({ hasText: "Нет связи" }).waitFor();
  const afterFirstPoll = refused;
  await page.clock.runFor(severalPollsMs);
  // The refused polls are the fact: the return has to survive them, not only the first failure.
  await expect.poll(() => refused).toBeGreaterThan(afterFirstPoll);
  expect(await page.locator("#alternative").getAttribute("href")).toBe("/sign-in");
  await page.keyboard.press("Tab");
  expect(await focusedId(page)).toBe("alternative");
  // The visual fixture has no Logto interaction; assert the return destination without starting auth.
  await page.route(`${origin}/sign-in`, async (route) => {
    await route.fulfill({ contentType: "text/html", body: "<h1>Sign-in fixture</h1>" });
  });
  await page.keyboard.press("Enter");
  await page.waitForURL(`${origin}/sign-in`);
  await page.close();
});

it.runIf(Boolean(process.env.STORYBOOK_UI_ORIGIN))("captures the exact Storybook presentation on desktop and mobile", async () => {
  for (const width of [1440, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${process.env.STORYBOOK_UI_ORIGIN ?? ""}/iframe.html?id=patterns-identity-telegram-sign-in--pending&viewMode=story`);
    await page.getByRole("heading", { name: "Вход через Telegram" }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    expect((await new AxeBuilder({ page }).include(".inside-telegram").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/storybook-pending-${String(width)}.png`, fullPage: true });
    await context.close();
  }
});


it("keeps the complete Telegram button geometry on narrow WebKit after loading", async () => {
  const mobileBrowser = await webkit.launch();
  try {
    for (const width of [320, 390]) {
      const page = await mobileBrowser.newPage({ viewport: { width, height: 844 }, isMobile: true, deviceScaleFactor: 3 });
      await open(page, "pending");
      const geometry = await page.locator("#bot").evaluate((element) => {
        const button = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const label = range.getBoundingClientRect();
        return { button: { height: button.height, left: button.left, right: button.right, bottom: button.bottom }, label: { left: label.left, right: label.right, bottom: label.bottom }, display: getComputedStyle(element).display, rects: element.getClientRects().length };
      });
      expect(geometry.display).toBe("flex");
      expect(geometry.rects).toBe(1);
      expect(geometry.button.height).toBeGreaterThanOrEqual(52);
      expect(geometry.label.left).toBeGreaterThanOrEqual(geometry.button.left);
      expect(geometry.label.right).toBeLessThanOrEqual(geometry.button.right);
      expect(geometry.label.bottom).toBeLessThanOrEqual(geometry.button.bottom);
      if (process.env.CAPTURE_TELEGRAM_EVIDENCE === "1") {
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: `${evidence}/webkit-${String(width)}.png` });
      }
      await page.close();
    }
  } finally { await mobileBrowser.close(); }
}, 30000);


it.each(["headers", "body"] as const)("leaves loading and retries when the first status response stalls at %s", async (stage) => {
  const page = await browser.newPage();
  stalledStatus = stage;
  state = { status: "pending", deepLink: botLink };
  offline = false;
  try {
    await page.goto(`${fixtureOrigin}/api/inside-telegram`);
    await page.getByRole("status").filter({ hasText: "Нет связи" }).waitFor({ timeout: 12000 });
    await page.locator("#bot").waitFor({ timeout: 5000 });
  } finally { stalledStatus = undefined; await page.close(); }
}, 20000);
