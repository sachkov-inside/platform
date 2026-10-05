import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";

import {
  createLogtoPassClient,
  registerLogSecret,
  readLogtoCredentials,
  type LogtoPassClient,
} from "./logto";
import { callMcpTool, distinctiveText, type McpToolCall } from "./mcp-client";
import {
  passCellParts,
  type BlockedPassRequest,
  type PassIdentity,
  type PassOutcome,
} from "./pass-cells";
import {
  expiredGrantEndsAt,
  guideA,
  identityEmail,
  passCells,
  productionTarget,
} from "./pass-config";
import {
  recordBlockedRequests,
  recordObservation,
  recordProblem,
} from "./pass-report";
import { guardPassContext, passContextGet } from "./pass-requests";

/**
 * Production-проход по ролям (#905, #906). Каждый тест наблюдает одну живую клетку `passCells` и
 * записывает факт; сравнение с ожиданием и итог делает отчёт в global teardown. Каждый запрос проходит allowlist до отправки
 * (`pass-requests.ts`), поэтому данные Platform проход не меняет. Записи есть только в Logto и в
 * сессиях: one-time token на вход, PAT на прогон (после прогона удаляется), сессии Logto и BFF
 * тестовых identities.
 *
 * Отказ ищет закрытые bytes, а не только сообщение об отказе: разрешённые чтения ученика A дают
 * отличительный текст тела и задания, id задания и адрес закрытой картинки, и проход ищет их в ответах
 * остальных identities.
 */
type Cell = (typeof passCells)[number];
interface Observation {
  readonly observed: PassOutcome;
  readonly note?: string;
}
type Actor = PassIdentity | "anonymous";

const runId = process.env["GITHUB_RUN_ID"] ?? `local-${randomUUID()}`;
/** Токен Platform API живёт 300 секунд; проход берёт новый раньше. */
const platformTokenReuseMs = 3 * 60_000;

const usedIdentities = new Map<PassIdentity, string>();
const sessions = new Map<Actor, BrowserContext>();
const platformTokens = new Map<
  PassIdentity,
  { readonly token: string; readonly issuedAt: number }
>();
const blocked: BlockedPassRequest[] = [];
let logto: LogtoPassClient | undefined;
let mailbox: string;

/** Факты разрешённых чтений ученика A: по ним проход ищет закрытые bytes у остальных. */
const learnerA: {
  bodySnippet?: string | undefined;
  practiceId?: string | undefined;
  practiceSnippet?: string | undefined;
  assetPath?: string | undefined;
} = {};

/** Ученик A идёт первым: его разрешённые чтения дают то, что остальные не должны получить. */
const learnerAFirst: readonly string[] = [
  "learner-guide-a/read-guide-a/body@learner-mcp",
  "learner-guide-a/read-guide-a/body@browser",
  "learner-guide-a/read-guide-a/practice@browser",
  "learner-guide-a/read-guide-a/practice@learner-mcp",
  "learner-guide-a/read-guide-a/assets@browser",
];
const liveCells = passCells
  .filter((cell: Cell) => !("deferred" in cell))
  .map((cell, index) => {
    const first = learnerAFirst.indexOf(cell.id);
    return { cell, order: first === -1 ? learnerAFirst.length + index : first };
  })
  .sort((a, b) => a.order - b.order)
  .map(({ cell }) => cell);

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
  for (const context of sessions.values()) await context.close();
  recordBlockedRequests(blocked);
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

/**
 * Тест клетки не падает: в режиме `serial` упавший тест пропустил бы все следующие клетки. Он
 * записывает факт или причину «не проверено», а итог считает отчёт в global teardown: расхождение
 * или «не проверено» роняют прогон там.
 */
for (const cell of liveCells) {
  test(cell.id, async ({ browser }) => {
    try {
      const { observed, note } = await observeCell(cell.id, browser);
      recordObservation({
        cellId: cell.id,
        observed,
        ...(note === undefined ? {} : { note }),
      });
    } catch (error) {
      recordProblem(cell.id, error);
    }
  });
}

async function observeCell(id: string, browser: Browser) {
  const { identity, surface, transport } = passCellParts(id);
  if (identity === "expired" && Date.now() < Date.parse(expiredGrantEndsAt)) {
    throw new Error("The expired identity grant has not expired yet");
  }
  switch (`${surface}@${transport}`) {
    case "body@browser":
      return observeBodyPage(await sessionOf(browser, identity));
    case "body@learner-mcp":
      return observeBodyThroughMcp(identity);
    case "assets@browser":
      return observeAsset(browser, identity);
    case "practice@browser":
      return observePracticePage(await sessionOf(browser, identity), identity);
    case "practice@learner-mcp":
      return observePracticeThroughMcp(identity);
    case "materials-authoring@browser":
      return observeMaterialsAuthoring(await sessionOf(browser, identity));
    case "billing-operations@owner-mcp":
      return observeBillingThroughOwnerMcp(identity);
    default:
      throw new Error(`No observer for pass cell ${id}`);
  }
}

// --------------------------------------------------------------------------- identities

/** Email identity скрыт в логе в обеих формах: как есть и в URL входа (`login_hint`). */
function emailOf(identity: PassIdentity): string {
  const email = registerLogSecret(identityEmail(mailbox, identity));
  registerLogSecret(encodeURIComponent(email));
  return email;
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

/** Токен Platform API identity; без Account (`anonymous`) запрос идёт без токена. */
async function platformTokenOf(actor: Actor): Promise<string | null> {
  if (actor === "anonymous") return null;
  const known = platformTokens.get(actor);
  if (known !== undefined && Date.now() - known.issuedAt < platformTokenReuseMs)
    return known.token;
  const userId = await userIdOf(actor);
  // PAT прогона и истёкшие PAT прошлых прогонов удаляются перед выпуском нового.
  await client().deletePassTokens(userId, runId);
  const token = await client().platformAccessToken(userId, runId);
  platformTokens.set(actor, { token, issuedAt: Date.now() });
  return token;
}

/**
 * Browser context под allowlist и, кроме `anonymous`, под настоящей сессией identity. Context живёт
 * весь прогон: вход идёт один раз на identity.
 */
async function sessionOf(
  browser: Browser,
  actor: Actor,
): Promise<BrowserContext> {
  const known = sessions.get(actor);
  if (known !== undefined) return known;
  const context = await browser.newContext({ baseURL: productionTarget.web });
  await guardPassContext(context, blocked);
  sessions.set(actor, context);
  if (actor !== "anonymous") {
    const page = await context.newPage();
    try {
      await signIn(page, actor);
    } finally {
      await page.close();
    }
  }
  return context;
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
      // Запрос с токеном идёт дальше через allowlist context.
      if (url.searchParams.has("one_time_token")) return route.fallback();
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
  const response = await passContextGet(page.context(), "/auth/status");
  expect(response.ok()).toBe(true);
  const status = z.object({ state: z.string() }).parse(await response.json());
  expect(status.state).toBe("authenticated");
}

// --------------------------------------------------------------------------- observers

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined)
    throw new Error(`${what} is missing: the allowed learner read failed`);
  return value;
}

/** Открывает урок Reader-ом и ждёт, пока он покажет тело или отказ. */
async function openMaterial(context: BrowserContext, slug: string) {
  const page = await context.newPage();
  await page.goto(`/materials/${slug}`);
  const state = page.locator(
    "#content [data-material-reader-state='available'], #content [data-material-reader-state='access-required']",
  );
  await expect(state.first()).toBeVisible();
  const readerState = await state
    .first()
    .getAttribute("data-material-reader-state");
  return { page, available: readerState === "available" };
}

async function observeBodyPage(context: BrowserContext): Promise<Observation> {
  const snippet = required(learnerA.bodySnippet, "Protected body snippet");
  const { page, available } = await openMaterial(
    context,
    guideA.bodyMaterialSlug,
  );
  try {
    // Закрытые bytes ищутся во всём документе, включая данные RSC, а не только в видимом тексте.
    if ((await page.content()).includes(snippet))
      return { observed: "allowed" };
    if (!available) return { observed: "denied", note: "access-required" };
    throw new Error("Material page shows neither the body nor a denial");
  } finally {
    await page.close();
  }
}

/** Ответ MCP: доступ, если tool ответил `ok` или в ответе есть закрытые bytes. */
function mcpObservation(
  call: McpToolCall,
  leakedSnippet: string | undefined,
): Observation {
  const leaked =
    leakedSnippet !== undefined && call.raw.includes(leakedSnippet);
  if (leaked || call.payload?.ok === true) return { observed: "allowed" };
  return {
    observed: "denied",
    note:
      call.payload === null
        ? `HTTP ${String(call.status)}`
        : call.payload.error.code,
  };
}

/** Отказ имеет ожидаемую форму: без Account — 401 транспорта, с Account — код tool. */
function expectDenial(actor: Actor, call: McpToolCall, code: string): void {
  if (actor === "anonymous") expect(call.status).toBe(401);
  else expect(call.payload).toEqual({ ok: false, error: { code } });
}

async function observeBodyThroughMcp(actor: Actor): Promise<Observation> {
  const call = await callMcpTool(
    productionTarget.learnerMcp,
    await platformTokenOf(actor),
    "learning_material_read",
    { slug: guideA.bodyMaterialSlug },
  );
  if (actor === "learner-guide-a" && call.payload?.ok === true) {
    const value = z.object({ body: z.unknown() }).parse(call.payload.value);
    learnerA.bodySnippet = distinctiveText(value.body, "text");
  }
  const observation = mcpObservation(call, learnerA.bodySnippet);
  if (observation.observed === "denied")
    expectDenial(actor, call, "material_not_available");
  return observation;
}

/** Id задания в JSON подсказки «Копировать» (`practiceReviewPrompt`). */
const practiceIdPattern = /"practiceId": "([^"]+)"/u;

async function observePracticePage(
  context: BrowserContext,
  actor: Actor,
): Promise<Observation> {
  const { page } = await openMaterial(context, guideA.practiceMaterialSlug);
  try {
    const region = page.getByRole("region", { name: "Проверка практики" });
    if (actor === "learner-guide-a") {
      const prompt = region.first().locator("pre code").first();
      await expect(prompt).toBeVisible();
      learnerA.practiceId = practiceIdPattern.exec(
        await prompt.innerText(),
      )?.[1];
      required(learnerA.practiceId, "Practice id");
      return { observed: "allowed" };
    }
    const practiceId = required(learnerA.practiceId, "Practice id");
    if (
      (await page.content()).includes(practiceId) ||
      (await region.count()) > 0
    )
      return { observed: "allowed" };
    return { observed: "denied", note: "нет блока практики" };
  } finally {
    await page.close();
  }
}

async function observePracticeThroughMcp(actor: Actor): Promise<Observation> {
  const practiceId = required(learnerA.practiceId, "Practice id");
  const call = await callMcpTool(
    productionTarget.learnerMcp,
    await platformTokenOf(actor),
    "learning_practice_read",
    { practiceId },
  );
  if (actor === "learner-guide-a" && call.payload?.ok === true)
    learnerA.practiceSnippet = distinctiveText(call.payload.value);
  const observation = mcpObservation(
    call,
    required(learnerA.practiceSnippet, "Practice snippet"),
  );
  if (observation.observed === "denied")
    expectDenial(actor, call, "practice_not_available");
  return observation;
}

/**
 * Закрытая картинка: Platform отвечает redirect на подписанный адрес хранилища, а отказ — 404.
 * Адрес картинки даёт страница урока у ученика A, ровно как его запрашивает Reader.
 */
async function observeAsset(
  browser: Browser,
  actor: Actor,
): Promise<Observation> {
  const context = await sessionOf(browser, actor);
  if (actor === "learner-guide-a") {
    const { page } = await openMaterial(context, guideA.practiceMaterialSlug);
    try {
      const image = page.locator("[data-reader-block='image'] img").first();
      await expect(image).toBeVisible();
      const source = await image.getAttribute("src");
      learnerA.assetPath =
        source === null
          ? undefined
          : new URL(source, productionTarget.web).href;
    } finally {
      await page.close();
    }
  }
  const response = await passContextGet(
    context,
    required(learnerA.assetPath, "Protected image address"),
  );
  const status = response.status();
  const location = response.headers()["location"];
  if (status === 302 && location !== undefined) {
    expect(new URL(location).origin).not.toBe(productionTarget.web);
    return { observed: "allowed", note: "HTTP 302" };
  }
  if (status === 404) return { observed: "denied", note: "HTTP 404" };
  if (status === 200 && actor === "learner-guide-a")
    throw new Error("The image is public: it proves no protected delivery");
  if (status === 200) return { observed: "allowed", note: "HTTP 200" };
  throw new Error(`Unexpected asset response ${String(status)}`);
}

async function observeMaterialsAuthoring(
  context: BrowserContext,
): Promise<Observation> {
  const response = await passContextGet(context, "/api/authoring/materials");
  expect(response.status()).toBe(200);
  const { kind } = z
    .object({ kind: z.enum(["ready", "forbidden"]) })
    .parse(await response.json());
  return kind === "ready"
    ? { observed: "allowed" }
    : { observed: "denied", note: "forbidden" };
}

async function observeBillingThroughOwnerMcp(
  actor: Actor,
): Promise<Observation> {
  const call = await callMcpTool(
    productionTarget.ownerMcp,
    await platformTokenOf(actor),
    "billing_tiers_list",
    { operationId: randomUUID(), limit: 1 },
  );
  const observation = mcpObservation(call, undefined);
  if (observation.observed === "denied") expectDenial(actor, call, "forbidden");
  return observation;
}
