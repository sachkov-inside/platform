import { createHash, randomUUID } from "node:crypto";

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
import {
  callMcpTool,
  distinctiveText,
  jsonStringLiterals,
  type McpToolCall,
} from "./mcp-client";
import {
  passCellParts,
  type BlockedPassRequest,
  type PassIdentity,
  type PassOutcome,
} from "./pass-cells";
import {
  expiredGrantEndsAt,
  productA,
  freePracticeId,
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
import { observeBodyPage as observeMaterialBody } from "./pass-browser";

/**
 * Production-проход по ролям (#905, #906). Один сценарий наблюдает живые клетки `passCells` и
 * записывает факты; сравнение с ожиданием и итог делает отчёт в global teardown. Каждый запрос
 * проходит allowlist до отправки (`pass-requests.ts`), поэтому данные Platform проход не меняет.
 * Записи есть только в Logto и в сессиях: one-time token на вход, PAT на прогон (после прогона
 * удаляется), сессии Logto и BFF тестовых identities.
 *
 * Отказ ищет закрытые bytes, а не только сообщение об отказе: разрешённые чтения ученика A дают
 * отличительный текст тела и задания, id задания и адрес закрытой картинки, и проход ищет их в
 * ответах остальных identities.
 */
type Cell = (typeof passCells)[number];
interface Observation {
  readonly observed: PassOutcome;
  readonly note?: string;
}
type Actor = PassIdentity | "anonymous";

/** Ученик A идёт первым: его разрешённые чтения дают то, что остальные не должны получить. */
const learnerAFirst: readonly string[] = [
  "learner-product-a/read-product-a/body@learner-mcp",
  "learner-product-a/read-product-a/body@browser",
  "learner-product-a/read-product-a/practice@browser",
  "learner-product-a/read-product-a/practice@learner-mcp",
  "learner-product-a/read-product-a/assets@browser",
];
const liveCells = passCells
  .filter((cell: Cell) => !("deferred" in cell))
  .map((cell, index) => {
    const first = learnerAFirst.indexOf(cell.id);
    return { cell, order: first === -1 ? learnerAFirst.length + index : first };
  })
  .sort((a, b) => a.order - b.order)
  .map(({ cell }) => cell);

test("production access observes every live cell in one isolated scenario", async ({
  browser,
}) => {
  const runId = process.env["GITHUB_RUN_ID"] ?? `local-${randomUUID()}`;
  /** Токен Platform API живёт 300 секунд; проход берёт новый раньше. */
  const platformTokenReuseMs = 3 * 60_000;

  const usedIdentities = new Map<PassIdentity, string>();
  const sessions = new Map<Actor, BrowserContext>();
  /** Неудачный вход: остальные клетки identity получают ту же причину, а не context без сессии. */
  const failedSignIns = new Map<Actor, unknown>();
  const platformTokens = new Map<
    PassIdentity,
    {
      readonly tokens: { readonly api: string; readonly learner: string };
      readonly issuedAt: number;
    }
  >();
  const blocked: BlockedPassRequest[] = [];
  let currentCellId: string | undefined;

  /** Факты разрешённых чтений ученика A: по ним проход ищет закрытые bytes у остальных. */
  const learnerA: {
    bodySnippet?: string | undefined;
    practiceId?: string | undefined;
    practiceSnippet?: string | undefined;
    assetPath?: string | undefined;
  } = {};

  async function observeCell(id: string, browser: Browser) {
    const { identity, action, surface, transport } = passCellParts(id);
    // deterministic-test-allow wall-clock: This live production adapter validates its seeded expired-role input against the real UTC grant owned by the remote backend.
    if (identity === "expired" && Date.now() < Date.parse(expiredGrantEndsAt)) {
      throw new Error("The expired identity grant has not expired yet");
    }
    switch (`${surface}@${transport}`) {
      case "body@browser":
        return observeBodyPage(await sessionOf(browser, identity), identity);
      case "body@learner-mcp":
        return observeBodyThroughMcp(identity);
      case "assets@browser":
        return observeAsset(browser, identity);
      case "practice@browser":
        return observePracticePage(
          await sessionOf(browser, identity),
          identity,
        );
      case "practice@learner-mcp":
        return action === "read-free-practice"
          ? observeFreePracticeThroughMcp(identity)
          : observePracticeThroughMcp(identity);
      case "materials-authoring@browser":
        return observeMaterialsAuthoring(
          await sessionOf(browser, identity),
          identity,
        );
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
    return logto;
  }

  async function userIdOf(identity: PassIdentity): Promise<string> {
    const known = usedIdentities.get(identity);
    if (known !== undefined) return known;
    const userId = await client().findUserId(emailOf(identity));
    usedIdentities.set(identity, userId);
    return userId;
  }

  /** Токены identity: Platform API и учебного MCP. Без Account (`anonymous`) их нет. */
  async function tokensOf(
    actor: PassIdentity,
  ): Promise<{ readonly api: string; readonly learner: string }> {
    const known = platformTokens.get(actor);
    if (
      known !== undefined &&
      performance.now() - known.issuedAt < platformTokenReuseMs
    )
      return known.tokens;
    const userId = await userIdOf(actor);
    // PAT прогона и истёкшие PAT прошлых прогонов удаляются перед выпуском нового.
    await client().deletePassTokens(userId, runId);
    const tokens = await client().accessTokens(userId, runId);
    platformTokens.set(actor, { tokens, issuedAt: performance.now() });
    return tokens;
  }

  /** Токен Platform API identity; без Account (`anonymous`) запрос идёт без токена. */
  async function platformTokenOf(actor: Actor): Promise<string | null> {
    return actor === "anonymous" ? null : (await tokensOf(actor)).api;
  }

  /** Токен учебного MCP identity; без Account (`anonymous`) запрос идёт без токена. */
  async function learnerTokenOf(actor: Actor): Promise<string | null> {
    return actor === "anonymous" ? null : (await tokensOf(actor)).learner;
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
    if (failedSignIns.has(actor)) throw failedSignIns.get(actor);
    const context = await browser.newContext({ baseURL: productionTarget.web });
    await guardPassContext(context, blocked, {
      identity: actor,
      currentCellId: () => currentCellId,
    });
    if (actor !== "anonymous") {
      const page = await context.newPage();
      try {
        await signIn(page, actor);
      } catch (error) {
        failedSignIns.set(actor, error);
        await context.close();
        throw error;
      } finally {
        if (!page.isClosed()) await page.close();
      }
    }
    sessions.set(actor, context);
    return context;
  }

  /**
   * Настоящий вход Logto по one-time token. Страница входа для людей не меняется: проход только
   * добавляет `one_time_token` и `login_hint` к запросу авторизации, который выпустил BFF.
   */
  async function signIn(page: Page, identity: PassIdentity): Promise<void> {
    const email = emailOf(identity);
    // Identity должна уже быть в Logto: вход по one-time token не регистрирует новых пользователей.
    await userIdOf(identity);
    const oneTimeToken = await client().issueOneTimeToken(email);
    await page.route(
      (url) =>
        url.origin === productionTarget.logto && url.pathname === "/oidc/auth",
      async (route) => {
        // Запрос с токеном — шаг redirect после ответа ниже: route его не видит, а проверяет
        // `guardPassContext` после отправки.
        const url = new URL(route.request().url());
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
    await expectSignedIn(page.context(), identity);
  }

  /**
   * Соседняя разрешённая возможность того же Account: сессия жива. Отказ без неё мог бы оказаться
   * следствием выпавшей сессии, а не границы права.
   */
  async function expectSignedIn(
    context: BrowserContext,
    actor: Actor,
  ): Promise<void> {
    if (actor === "anonymous") return;
    const response = await passContextGet(context, "/auth/status");
    expect(response.ok()).toBe(true);
    const status = z.object({ state: z.string() }).parse(await response.json());
    expect(status.state).toBe("authenticated");
  }

  /** Отказ в браузере засчитывается, только если сессия identity в этот момент жива. */
  async function browserDenial(
    context: BrowserContext,
    actor: Actor,
    note: string,
  ): Promise<Observation> {
    await expectSignedIn(context, actor);
    return { observed: "denied", note };
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
      "[data-application-content] [data-material-reader-state='available'], [data-application-content] [data-material-reader-state='access-required']",
    );
    await expect(state.first()).toBeVisible();
    const readerState = await state
      .first()
      .getAttribute("data-material-reader-state");
    return { page, available: readerState === "available" };
  }

  async function observeBodyPage(
    context: BrowserContext,
    actor: Actor,
  ): Promise<Observation> {
    const snippet = required(learnerA.bodySnippet, "Protected body snippet");
    const observation = await observeMaterialBody(
      context,
      productA.bodyMaterialSlug,
      snippet,
    );
    if (observation.observed === "denied") await expectSignedIn(context, actor);
    return observation;
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
      await learnerTokenOf(actor),
      "learning_material_read",
      { slug: productA.bodyMaterialSlug },
    );
    if (actor === "learner-product-a" && call.payload?.ok === true) {
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
    const { page } = await openMaterial(context, productA.practiceMaterialSlug);
    try {
      const region = page.getByRole("region", { name: "Проверка практики" });
      if (actor === "learner-product-a") {
        // Первым в блоке стоит запрос подключения агента; id задания есть только в запросе практики.
        const prompt = region
          .first()
          .locator("pre code", { hasText: '"practiceId"' })
          .first();
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
      return await browserDenial(context, actor, "нет блока практики");
    } finally {
      await page.close();
    }
  }

  async function observePracticeThroughMcp(actor: Actor): Promise<Observation> {
    const practiceId = required(learnerA.practiceId, "Practice id");
    const call = await callMcpTool(
      productionTarget.learnerMcp,
      await learnerTokenOf(actor),
      "learning_practice_read",
      { practiceId },
    );
    if (actor === "learner-product-a" && call.payload?.ok === true) {
      // Часть 0 — кусок canonical JSON строкой `data`: отличительный текст ищется среди её строк.
      const { data } = z.object({ data: z.string() }).parse(call.payload.value);
      learnerA.practiceSnippet = distinctiveText(jsonStringLiterals(data));
    }
    const observation = mcpObservation(
      call,
      required(learnerA.practiceSnippet, "Practice snippet"),
    );
    if (observation.observed === "denied")
      expectDenial(actor, call, "practice_not_available");
    return observation;
  }

  /** Бесплатный Account читает все части одной версии, включая завершающий маркер. */
  async function observeFreePracticeThroughMcp(
    actor: Actor,
  ): Promise<Observation> {
    const token = await learnerTokenOf(actor);
    const partSchema = z.object({
      practiceId: z.literal(freePracticeId),
      contextVersion: z.string().min(1),
      contentSha256: z.hash("sha256"),
      part: z.number().int().nonnegative(),
      partCount: z.number().int().positive(),
      nextPart: z.number().int().nullable(),
      data: z.string().min(1),
    });
    const read = async (part: number, pin?: z.infer<typeof partSchema>) => {
      const call = await callMcpTool(
        productionTarget.learnerMcp,
        token,
        "learning_practice_read",
        {
          practiceId: freePracticeId,
          part,
          ...(pin === undefined
            ? {}
            : {
                expectedContextVersion: pin.contextVersion,
                expectedContentSha256: pin.contentSha256,
              }),
        },
      );
      expect(call.status).toBe(200);
      expect(call.payload?.ok).toBe(true);
      return partSchema.parse(
        call.payload?.ok === true ? call.payload.value : null,
      );
    };
    const first = await read(0);
    let context = "";
    for (let part = 0; part < first.partCount; part += 1) {
      const current = part === 0 ? first : await read(part, first);
      expect(current).toMatchObject({
        part,
        partCount: first.partCount,
        contextVersion: first.contextVersion,
        contentSha256: first.contentSha256,
        nextPart: part + 1 < first.partCount ? part + 1 : null,
      });
      context += current.data;
    }
    expect(createHash("sha256").update(context).digest("hex")).toBe(
      first.contentSha256,
    );
    expect(
      z
        .object({
          contextVersion: z.literal(first.contextVersion),
          terminalMarker: z.literal(`END_CONTEXT:${first.contextVersion}`),
          payload: z.object({
            practice: z.unknown(),
            referenceLesson: z.unknown(),
          }),
        })
        .safeParse(JSON.parse(context) as unknown).success,
    ).toBe(true);
    return {
      observed: "allowed",
      note: `прочитаны все ${String(first.partCount)} частей; SHA-256 и END_CONTEXT совпали`,
    };
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
    if (actor === "learner-product-a") {
      const { page } = await openMaterial(
        context,
        productA.practiceMaterialSlug,
      );
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
    if (status === 404) return browserDenial(context, actor, "HTTP 404");
    if (status === 200 && actor === "learner-product-a")
      throw new Error("The image is public: it proves no protected delivery");
    if (status === 200) return { observed: "allowed", note: "HTTP 200" };
    throw new Error(`Unexpected asset response ${String(status)}`);
  }

  async function observeMaterialsAuthoring(
    context: BrowserContext,
    actor: Actor,
  ): Promise<Observation> {
    const response = await passContextGet(context, "/api/authoring/materials");
    const { kind } = z
      .object({ kind: z.enum(["ready", "forbidden"]) })
      .parse(await response.json());
    expect(response.status()).toBe(kind === "ready" ? 200 : 403);
    return kind === "ready"
      ? { observed: "allowed" }
      : browserDenial(context, actor, "forbidden");
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
    if (observation.observed === "denied")
      expectDenial(actor, call, "forbidden");
    return observation;
  }

  const credentials = readLogtoCredentials();
  const configuredMailbox = process.env["PRODUCTION_ACCESS_MAILBOX"];
  if (credentials === undefined || configuredMailbox === undefined) {
    throw new Error(
      "PRODUCTION_ACCESS_LOGTO_APP_ID, PRODUCTION_ACCESS_LOGTO_APP_SECRET and PRODUCTION_ACCESS_MAILBOX are required",
    );
  }
  const mailbox = registerLogSecret(configuredMailbox);
  const logto = await createLogtoPassClient(credentials);
  const failures: unknown[] = [];
  try {
    // A failed cell is recorded; the remaining cells still produce their own evidence.
    // Global teardown compares the observations and fails mismatches or missing evidence.
    for (const cell of liveCells) {
      await test.step(cell.id, async () => {
        currentCellId = cell.id;
        try {
          const { observed, note } = await observeCell(cell.id, browser);
          recordObservation({
            cellId: cell.id,
            observed,
            ...(note === undefined ? {} : { note }),
          });
        } catch (error) {
          recordProblem(cell.id, error);
        } finally {
          currentCellId = undefined;
        }
      });
    }
  } finally {
    for (const context of sessions.values()) {
      await context.close().catch((error: unknown) => failures.push(error));
    }
    recordBlockedRequests(blocked);
    // Every identity gets its cleanup attempt even when another cleanup fails.
    for (const userId of usedIdentities.values()) {
      await logto.deletePassTokens(userId, runId).catch((error: unknown) => {
        failures.push(error);
      });
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Pass session/PAT cleanup failed");
  }
});
