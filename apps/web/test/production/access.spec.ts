import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  createLogtoPassClient,
  masked,
  readLogtoCredentials,
  type LogtoPassClient,
} from "./logto";
import { protectedBodySnippet, readLearnerMaterial } from "./learner-mcp";
import type { PassIdentity, PassOutcome } from "./pass-cells";
import {
  guideA,
  identityEmail,
  passCells,
  productionTarget,
} from "./pass-config";
import { recordObservation } from "./pass-report";

/**
 * Минимальный read-only production-проход (#905). Каждый тест наблюдает одну клетку `passCells` и
 * записывает факт до проверки ожидания. Тест, упавший до записи, оставляет клетку «не проверено»:
 * отчёт в global teardown делает тогда job красным. Проход только читает: вход идёт настоящим
 * Logto, а запросы — GET страниц и вызовы read-only tool учебного MCP.
 */
type LiveCellId = Exclude<
  (typeof passCells)[number],
  { readonly deferred: string }
>["id"];

const runId = process.env["GITHUB_RUN_ID"] ?? `local-${randomUUID()}`;
const usedIdentities = new Map<PassIdentity, string>();
let logto: LogtoPassClient | undefined;
let mailbox: string;
/** Отличительный текст закрытого тела Guide A; его даёт разрешённое чтение ученика A. */
let protectedSnippet: string | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const credentials = readLogtoCredentials();
  const configuredMailbox = process.env["PRODUCTION_ACCESS_MAILBOX"];
  if (credentials === undefined || configuredMailbox === undefined) {
    throw new Error(
      "PRODUCTION_ACCESS_LOGTO_APP_ID, PRODUCTION_ACCESS_LOGTO_APP_SECRET and PRODUCTION_ACCESS_MAILBOX are required",
    );
  }
  mailbox = masked(configuredMailbox);
  logto = await createLogtoPassClient(credentials);
});

test.afterAll(async () => {
  // PAT живут только прогон; ошибка удаления видна в логе и в красном прогоне.
  for (const userId of usedIdentities.values()) {
    await logto?.deletePassTokens(userId);
  }
});

function client(): LogtoPassClient {
  if (logto === undefined) throw new Error("Logto client is not ready");
  return logto;
}

async function userIdOf(identity: PassIdentity): Promise<string> {
  const known = usedIdentities.get(identity);
  if (known !== undefined) return known;
  const userId = await client().findUserId(identityEmail(mailbox, identity));
  usedIdentities.set(identity, userId);
  return userId;
}

async function readThroughLearnerMcp(identity: PassIdentity) {
  const userId = await userIdOf(identity);
  // Остатки прошлого прогона не копятся: перед выпуском PAT проход удаляет свои старые.
  await client().deletePassTokens(userId);
  const token = await client().platformAccessToken(userId, runId);
  return readLearnerMaterial(token, guideA.protectedMaterialSlug);
}

/**
 * Настоящий вход Logto по one-time token. Страница входа для людей не меняется: проход только
 * добавляет `one_time_token` и `login_hint` к запросу авторизации, который выпустил BFF.
 */
async function signIn(page: Page, identity: PassIdentity): Promise<void> {
  const email = identityEmail(mailbox, identity);
  const oneTimeToken = await client().issueOneTimeToken(email);
  await page.route(
    (url) =>
      url.origin === productionTarget.logto && url.pathname === "/oidc/auth",
    async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("one_time_token")) return route.continue();
      url.searchParams.set("one_time_token", oneTimeToken);
      url.searchParams.set("login_hint", email);
      return route.fulfill({
        status: 302,
        headers: { location: url.toString() },
      });
    },
  );
  await page.goto("/");
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/auth/sign-in";
    document.body.append(form);
    form.submit();
  });
  await page.waitForURL((url) => url.origin === productionTarget.logto);
  await page.waitForURL(
    (url) =>
      url.origin === productionTarget.web &&
      !url.pathname.startsWith("/auth/") &&
      url.pathname !== "/callback",
  );
  const landing = new URL(page.url());
  // Условия принимает одноразовая настройка; проход сам ничего не пишет.
  expect(
    landing.pathname,
    "test identity must have accepted the terms during setup",
  ).not.toBe("/welcome");
  expect(landing.searchParams.get("authentication")).toBeNull();
  const status = await page.evaluate(async () => {
    const response = await fetch("/auth/status");
    return (await response.json()) as { state: string };
  });
  expect(status.state).toBe("authenticated");
}

async function observeMaterialPage(page: Page): Promise<PassOutcome> {
  if (protectedSnippet === undefined) {
    throw new Error("No protected snippet: the allowed learner read failed");
  }
  await page.goto(`/materials/${guideA.protectedMaterialSlug}`);
  const state = page.locator(
    "#content [data-material-reader-state='available'], #content [data-material-reader-state='access-required']",
  );
  await expect(state.first()).toBeVisible();
  // Закрытые bytes ищутся во всём документе, включая данные RSC, а не только в видимом тексте.
  if ((await page.content()).includes(protectedSnippet)) return "allowed";
  if (
    (await state.first().getAttribute("data-material-reader-state")) ===
    "access-required"
  )
    return "denied";
  throw new Error("Material page shows neither the body nor a denial");
}

function observe(cellId: LiveCellId, observed: PassOutcome): void {
  recordObservation({ cellId, observed });
  const cell = passCells.find(({ id }) => id === cellId);
  expect(observed, cellId).toBe(cell?.expected);
}

test("learner-guide-a/learner-mcp/guide-a-body", async () => {
  const read = await readThroughLearnerMcp("learner-guide-a");
  if (read.ok) protectedSnippet = protectedBodySnippet(read.value);
  observe(
    "learner-guide-a/learner-mcp/guide-a-body",
    read.ok ? "allowed" : "denied",
  );
});

test("learner-guide-a/browser/guide-a-body", async ({ page }) => {
  await signIn(page, "learner-guide-a");
  observe(
    "learner-guide-a/browser/guide-a-body",
    await observeMaterialPage(page),
  );
});

test("no-entitlement/learner-mcp/guide-a-body", async () => {
  if (protectedSnippet === undefined) {
    throw new Error("No protected snippet: the allowed learner read failed");
  }
  const read = await readThroughLearnerMcp("no-entitlement");
  const leaked = read.raw.includes(protectedSnippet);
  if (!leaked && !read.ok) {
    expect(read.error.code).toBe("material_not_available");
  }
  observe(
    "no-entitlement/learner-mcp/guide-a-body",
    leaked || read.ok ? "allowed" : "denied",
  );
});

test("no-entitlement/browser/guide-a-body", async ({ page }) => {
  await signIn(page, "no-entitlement");
  observe(
    "no-entitlement/browser/guide-a-body",
    await observeMaterialPage(page),
  );
});
