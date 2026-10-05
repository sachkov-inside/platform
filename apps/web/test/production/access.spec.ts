import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

import {
  createLogtoPassClient,
  registerLogSecret,
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
 * Минимальный production-проход (#905). Каждый тест наблюдает одну клетку `passCells` и записывает
 * факт до проверки ожидания. Тест, упавший до записи, оставляет клетку «не проверено»: отчёт в global
 * teardown делает тогда job красным. Данные Platform проход не меняет: он открывает GET-страницы и
 * вызывает read-only tool учебного MCP. Записи есть только в Logto и в сессиях: one-time token на
 * вход, PAT на прогон (после прогона удаляется), сессии Logto и BFF тестовых identities.
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
  mailbox = registerLogSecret(configuredMailbox);
  logto = await createLogtoPassClient(credentials);
});

test.afterAll(async () => {
  // PAT живут только прогон. Сбой удаления у одной identity не оставляет PAT остальных; ошибки
  // поднимаются в конце, и прогон краснеет.
  const failures: unknown[] = [];
  for (const userId of usedIdentities.values()) {
    await logto?.deletePassTokens(userId, runId).catch((error: unknown) => {
      failures.push(error);
    });
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Pass PAT cleanup failed");
  }
});

/** Email identity скрыт в логе в обеих формах: как есть и в URL входа (`login_hint`). */
function emailOf(identity: PassIdentity): string {
  const email = registerLogSecret(identityEmail(mailbox, identity));
  registerLogSecret(encodeURIComponent(email));
  return email;
}

function requireProtectedSnippet(): string {
  if (protectedSnippet === undefined) {
    throw new Error("No protected snippet: the allowed learner read failed");
  }
  return protectedSnippet;
}

function client(): LogtoPassClient {
  if (logto === undefined) throw new Error("Logto client is not ready");
  return logto;
}

async function userIdOf(identity: PassIdentity): Promise<string> {
  const known = usedIdentities.get(identity);
  if (known !== undefined) return known;
  const userId = await client().findUserId(emailOf(identity));
  usedIdentities.set(identity, userId);
  return userId;
}

async function readThroughLearnerMcp(identity: PassIdentity) {
  const userId = await userIdOf(identity);
  // Истёкшие PAT прошлых прогонов не копятся: проход удаляет их перед выпуском нового.
  await client().deletePassTokens(userId, runId);
  const token = await client().platformAccessToken(userId, runId);
  return readLearnerMaterial(token, guideA.protectedMaterialSlug);
}

/**
 * Настоящий вход Logto по one-time token. Страница входа для людей не меняется: проход только
 * добавляет `one_time_token` и `login_hint` к запросу авторизации, который выпустил BFF.
 */
async function signIn(page: Page, identity: PassIdentity): Promise<void> {
  const email = emailOf(identity);
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
  // Условия принимает одноразовая настройка: проход не пишет согласия сам.
  expect(
    landing.pathname,
    "test identity must have accepted the terms during setup",
  ).not.toBe("/welcome");
  expect(landing.searchParams.get("authentication")).toBeNull();
  // Запрос контекста несёт cookies сессии браузера.
  const response = await page.request.get("/auth/status");
  expect(response.ok()).toBe(true);
  const status = z.object({ state: z.string() }).parse(await response.json());
  expect(status.state).toBe("authenticated");
}

async function observeMaterialPage(page: Page): Promise<PassOutcome> {
  const snippet = requireProtectedSnippet();
  await page.goto(`/materials/${guideA.protectedMaterialSlug}`);
  const state = page.locator(
    "#content [data-material-reader-state='available'], #content [data-material-reader-state='access-required']",
  );
  await expect(state.first()).toBeVisible();
  // Закрытые bytes ищутся во всём документе, включая данные RSC, а не только в видимом тексте.
  if ((await page.content()).includes(snippet)) return "allowed";
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
  const snippet = requireProtectedSnippet();
  const read = await readThroughLearnerMcp("no-entitlement");
  const leaked = read.raw.includes(snippet);
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
