import { createHash, randomUUID } from "node:crypto";

import {
  errors,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Request as BrowserRequest,
  type Response as BrowserResponse,
} from "@playwright/test";
import { z } from "zod";

import {
  createLogtoPassClient,
  registerLogSecret,
  readLogtoCredentials,
  type LogtoPassClient,
} from "./logto";
import {
  assertMcpDenial,
  callMcpTool,
  distinctiveText,
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
  freeVideoMaterialSlug,
  productA,
  retiredTaskCode,
  freeTaskCode,
  identityEmail,
  passCells,
  productionTarget,
} from "./pass-config";
import {
  recordBlockedRequests,
  recordObservation,
  recordProblem,
} from "./pass-report";
import {
  guardPassContext,
  kinescopeLicencePath,
  passContextGet,
  passPagePost,
  videoPlaybackSessions,
} from "./pass-requests";
import { observeBodyPage as observeMaterialBody } from "./pass-browser";

/**
 * Production-проход по ролям (#905, #906). Один сценарий наблюдает живые клетки `passCells` и
 * записывает факты; сравнение с ожиданием и итог делает отчёт в global teardown. Каждый запрос
 * проходит allowlist до отправки (`pass-requests.ts`), поэтому данные Platform проход не меняет.
 * Записи есть только в Logto и в сессиях: one-time token на вход, PAT на прогон (после прогона
 * удаляется), сессии Logto и BFF тестовых identities.
 *
 * Отказ ищет закрытые bytes, а не только сообщение об отказе: разрешённые чтения ученика A дают
 * отличительный текст тела и задания, адрес закрытой картинки и запрос playback session закрытого
 * видео, и проход ищет их в ответах остальных identities.
 */
type Cell = (typeof passCells)[number];
interface Observation {
  readonly observed: PassOutcome;
  readonly note?: string;
}
type Actor = PassIdentity | "anonymous";

const playbackSessionInputSchema = z.object({
  materialId: z.uuid(),
  videoId: z.uuid(),
});
type PlaybackSessionInput = z.infer<typeof playbackSessionInputSchema>;

/** Стоп для зависшего плеера: в production лицензия приходит за секунды после запуска. */
const licenceBudgetMs = 90_000;
/**
 * Окно, в котором плеер без токена мог бы получить лицензию другой схемы шифрования. Отказ
 * засчитывается, только когда за всё окно лицензия не пришла.
 */
const tokenlessLicenceBudgetMs = 30_000;

function isPlaybackSessionRequest(request: BrowserRequest): boolean {
  return (
    request.method() === "POST" &&
    new URL(request.url()).href ===
      new URL(videoPlaybackSessions, productionTarget.web).href
  );
}

/** Ответ Kinescope на запрос лицензии из плеера на этой странице, а не на соседней. */
function isLicenceResponse(response: BrowserResponse, page: Page): boolean {
  const url = new URL(response.url());
  if (
    url.origin !== productionTarget.kinescopeLicence ||
    !kinescopeLicencePath.test(url.pathname)
  )
    return false;
  try {
    return response.frame().page() === page;
  } catch {
    // A service worker response belongs to no page.
    return false;
  }
}

/**
 * Следит за лицензиями плеера страницы с момента вызова. Плеер может попробовать несколько схем
 * шифрования, поэтому итог — выданная лицензия, а без неё последний отказ или `null` без ответа.
 */
function watchLicences(page: Page) {
  const refused: number[] = [];
  let granted = false;
  const listener = (response: BrowserResponse) => {
    if (!isLicenceResponse(response, page)) return;
    if (response.status() === 200) granted = true;
    else refused.push(response.status());
  };
  page.context().on("response", listener);
  const stop = () => page.context().off("response", listener);
  return {
    /** Снимает слежение, если до `outcome` дело не дошло; повторный вызов безвреден. */
    stop,
    async outcome(budgetMs: number): Promise<number | null> {
      try {
        if (!granted)
          await page.context().waitForEvent("response", {
            predicate: (response) =>
              isLicenceResponse(response, page) && response.status() === 200,
            timeout: budgetMs,
          });
        return 200;
      } catch (error) {
        if (!(error instanceof errors.TimeoutError)) throw error;
        return refused.at(-1) ?? null;
      } finally {
        stop();
      }
    },
  };
}

/** Ждёт, пока Reader покажет тело или отказ, и говорит, открыт ли урок. */
async function readerAvailable(page: Page): Promise<boolean> {
  const state = page
    .locator(
      "[data-application-content] [data-material-reader-state='available'], [data-application-content] [data-material-reader-state='access-required']",
    )
    .first();
  await expect(state).toBeVisible();
  return (
    (await state.getAttribute("data-material-reader-state")) === "available"
  );
}

/** Ученик A идёт первым: его разрешённые чтения дают то, что остальные не должны получить. */
const learnerAFirst: readonly string[] = [
  "learner-product-a/read-product-a/body@learner-mcp",
  "learner-product-a/read-product-a/body@browser",
  "learner-product-a/read-product-a/practice@learner-mcp",
  "learner-product-a/read-product-a/practice@browser",
  "learner-product-a/read-product-a/assets@browser",
  "learner-product-a/read-product-a/video@browser",
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
    taskSnippet?: string | undefined;
    assetPath?: string | undefined;
    video?:
      | {
          readonly session: PlaybackSessionInput;
          readonly embedLocator: string;
        }
      | undefined;
  } = {};

  async function observeCell(
    id: string,
    browser: Browser,
  ): Promise<Observation> {
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
      case "video@browser": {
        const context = await sessionOf(browser, identity);
        if (action === "read-free-lesson")
          return observeVideoPlayback(context, identity, freeVideoMaterialSlug);
        return identity === "learner-product-a"
          ? observeVideoPlayback(context, identity, productA.videoMaterialSlug)
          : observeVideoDenial(context, identity);
      }
      case "practice@browser":
        return observeTaskPage(await sessionOf(browser, identity), identity);
      case "practice@learner-mcp":
        if (action === "read-retired-practice") {
          const call = await callMcpTool(
            productionTarget.learnerMcp,
            await learnerTokenOf(identity),
            "learning_task_read",
            { code: retiredTaskCode, part: 0 },
          );
          expectDenial(identity, call, "task_not_available");
          assertMcpDenial(call.raw, "task_not_available");
          return {
            observed: "denied",
            note: "task_not_available; контекст не выдан",
          };
        }
        return action === "read-free-practice"
          ? observeFreePracticeThroughMcp(identity)
          : observeTaskThroughMcp(identity);
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
      const entry = document.createElement("input");
      entry.type = "hidden";
      entry.name = "entry";
      entry.value = "account-choice";
      form.append(entry);
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
    return { page, available: await readerAvailable(page) };
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

  async function observeTaskPage(
    context: BrowserContext,
    actor: Actor,
  ): Promise<Observation> {
    const page = await context.newPage();
    try {
      await page.goto(`/products/${productA.slug}/tasks/${productA.taskCode}`);
      const task = page.locator(`[data-product-task="${productA.taskCode}"]`);
      const snippet = required(learnerA.taskSnippet, "Task snippet");
      if (actor === "learner-product-a") {
        await expect(task).toHaveAttribute("data-product-task-state", "open");
        expect(await page.content()).toContain(snippet);
        return { observed: "allowed" };
      }
      // Код и заголовок публичны. Закрытые bytes не должны попасть даже в HTML/RSC.
      if (
        (await page.content()).includes(snippet) ||
        (await task.getAttribute("data-product-task-state")) === "open"
      )
        return { observed: "allowed" };
      await expect(task).toHaveAttribute("data-product-task-state", "closed");
      return await browserDenial(context, actor, "задание закрыто");
    } finally {
      await page.close();
    }
  }

  async function observeTaskThroughMcp(actor: Actor): Promise<Observation> {
    const token = await learnerTokenOf(actor);
    const reference = { code: productA.taskCode };
    const call = await callMcpTool(
      productionTarget.learnerMcp,
      token,
      "learning_task_read",
      { ...reference, part: 0 },
    );
    if (actor === "learner-product-a" && call.payload?.ok === true) {
      const context = await readContextParts(
        token,
        "learning_task_read",
        reference,
        call,
      );
      const { payload } = z
        .object({
          payload: z.object({
            task: z.object({
              code: z.literal(productA.taskCode),
              page: z.object({ body: z.unknown() }),
            }),
          }),
        })
        .parse(context);
      learnerA.taskSnippet = distinctiveText(payload.task.page.body, "text");
    }
    const observation = mcpObservation(
      call,
      required(learnerA.taskSnippet, "Task snippet"),
    );
    if (observation.observed === "denied")
      expectDenial(actor, call, "task_not_available");
    return observation;
  }

  /** Все части одного snapshot: проверяются pins, bytes, SHA-256 и завершающий маркер. */
  async function readContextParts(
    token: string | null,
    tool: "learning_task_read",
    reference: { readonly code: string },
    firstCall: McpToolCall,
  ): Promise<unknown> {
    const partSchema = z.object({
      contextVersion: z.string().min(1),
      contentSha256: z.hash("sha256"),
      contentBytes: z.number().int().positive(),
      part: z.number().int().nonnegative(),
      partCount: z.number().int().positive(),
      nextPart: z.number().int().nullable(),
      data: z.string().min(1),
    });
    const parse = (call: McpToolCall) => {
      expect(call.status).toBe(200);
      expect(call.payload?.ok).toBe(true);
      const value = call.payload?.ok === true ? call.payload.value : null;
      expect(value).toMatchObject(reference);
      return partSchema.parse(value);
    };
    const first = parse(firstCall);
    let context = "";
    for (let part = 0; part < first.partCount; part += 1) {
      const current =
        part === 0
          ? first
          : parse(
              await callMcpTool(productionTarget.learnerMcp, token, tool, {
                ...reference,
                part,
                expectedContextVersion: first.contextVersion,
                expectedContentSha256: first.contentSha256,
              }),
            );
      expect(current).toMatchObject({
        part,
        partCount: first.partCount,
        contextVersion: first.contextVersion,
        contentSha256: first.contentSha256,
        contentBytes: first.contentBytes,
        nextPart: part + 1 < first.partCount ? part + 1 : null,
      });
      context += current.data;
    }
    expect(Buffer.byteLength(context, "utf8")).toBe(first.contentBytes);
    expect(createHash("sha256").update(context).digest("hex")).toBe(
      first.contentSha256,
    );
    return z
      .object({
        contextVersion: z.literal(first.contextVersion),
        terminalMarker: z.literal(`END_CONTEXT:${first.contextVersion}`),
        payload: z.unknown(),
      })
      .parse(JSON.parse(context) as unknown);
  }

  /** Бесплатный Account читает все части одной версии, включая завершающий маркер. */
  async function observeFreePracticeThroughMcp(
    actor: Actor,
  ): Promise<Observation> {
    if (freeTaskCode === null)
      throw new Error(
        "Current free Task publication is deferred by pass configuration",
      );
    const token = await learnerTokenOf(actor);
    const call = await callMcpTool(
      productionTarget.learnerMcp,
      token,
      "learning_task_read",
      { code: freeTaskCode, part: 0 },
    );
    const context = await readContextParts(
      token,
      "learning_task_read",
      { code: freeTaskCode },
      call,
    );
    z.object({
      payload: z.object({
        task: z.object({
          code: z.literal(freeTaskCode),
          definition: z.unknown(),
        }),
      }),
    }).parse(context);
    return {
      observed: "allowed",
      note: "прочитаны все части; SHA-256, число bytes и END_CONTEXT совпали",
    };
  }

  /**
   * Закрытая картинка: с v52 Caddy отдаёт её байты с sachkov.dev с `Cache-Control: private` (#1766).
   * Перенаправление в хранилище значит, что перехват не сработал, и проход краснеет. Отказ: 404.
   * Адрес картинки даёт страница урока у ученика A, ровно как его запрашивает Reader.
   */
  async function observeAsset(
    browser: Browser,
    actor: Actor,
  ): Promise<Observation> {
    const context = await sessionOf(browser, actor);
    if (actor === "learner-product-a") {
      const { page } = await openMaterial(context, productA.assetMaterialSlug);
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
    if (status === 404) return browserDenial(context, actor, "HTTP 404");
    if (
      status === 200 &&
      /^private\b/u.test(response.headers()["cache-control"] ?? "")
    )
      return { observed: "allowed", note: "HTTP 200 private с sachkov.dev" };
    if (status === 200 && actor === "learner-product-a")
      throw new Error("The image is public: it proves no protected delivery");
    if (status === 200) return { observed: "allowed", note: "HTTP 200" };
    throw new Error(`Unexpected asset response ${String(status)}`);
  }

  /**
   * Основное видео глазами Reader: страница урока сама просит playback session, проход запускает
   * плеер и ждёт ответа Kinescope на запрос лицензии. Kinescope выдаёт её, только когда authorization
   * backend Platform повторил решение `play` по токену сессии. Запись защищена у любого урока
   * (ADR 0041), поэтому сессия без токена ничего не доказывает.
   */
  async function observeVideoPlayback(
    context: BrowserContext,
    actor: Actor,
    slug: string,
  ): Promise<Observation> {
    const page = await context.newPage();
    const licences = watchLicences(page);
    try {
      const sessionRequest = page.waitForRequest(isPlaybackSessionRequest);
      // A closed lesson sends no request: the page closes with the wait still pending.
      sessionRequest.catch(() => undefined);
      await page.goto(`/materials/${slug}`);
      if (!(await readerAvailable(page)))
        return await browserDenial(
          context,
          actor,
          "урок закрыт: access-required",
        );
      const request = await sessionRequest;
      const response = await request.response();
      if (response === null)
        throw new Error("The playback session request got no response");
      if (response.status() !== 200)
        return await browserDenial(
          context,
          actor,
          `playback session: HTTP ${String(response.status())}`,
        );
      const session = z
        .object({ drmAuthToken: z.string().nullable(), embedLocator: z.url() })
        .parse(await response.json());
      if (session.drmAuthToken === null)
        throw new Error(
          "The recording plays without a token: it proves no protected delivery",
        );
      if (actor === "learner-product-a" && slug === productA.videoMaterialSlug)
        learnerA.video = {
          session: playbackSessionInputSchema.parse(request.postDataJSON()),
          embedLocator: session.embedLocator,
        };
      // Плеер спрашивает лицензию, когда начинает воспроизведение.
      const poster = page.getByRole("button", { name: /^Смотреть видео/u });
      if (await poster.isVisible()) await poster.click();
      else await page.locator("[data-video-player-mount] iframe").click();
      const licence = await licences.outcome(licenceBudgetMs);
      if (licence === null)
        throw new Error("The player requested no licence of the recording");
      return licence === 200
        ? {
            observed: "allowed",
            note: "playback session с токеном; лицензия Kinescope HTTP 200",
          }
        : await browserDenial(
            context,
            actor,
            `playback session с токеном; лицензия Kinescope HTTP ${String(licence)}`,
          );
    } finally {
      licences.stop();
      await page.close();
    }
  }

  /**
   * Отказ: со страницы закрытого урока identity просит playback session того же видео, что получил
   * ученик A. Гость вдобавок запускает ту же запись без токена: Kinescope не выдаёт лицензию, пока
   * authorization backend Platform не подтвердил доступ. Без Account и права у других identities
   * токена тоже нет, поэтому эта проверка одна.
   */
  async function observeVideoDenial(
    context: BrowserContext,
    actor: Actor,
  ): Promise<Observation> {
    const video = required(learnerA.video, "Protected video session");
    const page = await context.newPage();
    try {
      await page.goto(`/materials/${productA.videoMaterialSlug}`);
      if (await readerAvailable(page))
        return { observed: "allowed", note: "урок открыт" };
      const response = await passPagePost(
        page,
        videoPlaybackSessions,
        video.session,
      );
      if (response.status === 200 || response.text.includes("drmAuthToken"))
        return {
          observed: "allowed",
          note: `playback session: HTTP ${String(response.status)}`,
        };
      // Чужой Origin получает тот же 403, но без тела; код говорит, что решение принял backend.
      expect(response.status).toBe(403);
      expect(JSON.parse(response.text)).toEqual({
        code: "playback_unavailable",
      });
      if (actor !== "anonymous")
        return await browserDenial(
          context,
          actor,
          "playback session: HTTP 403 playback_unavailable",
        );
      const licence = await tokenlessLicence(page, video.embedLocator);
      if (licence === 200)
        return { observed: "allowed", note: "лицензия без токена: HTTP 200" };
      if (licence === null)
        throw new Error("The tokenless player requested no licence");
      return await browserDenial(
        context,
        actor,
        `playback session: HTTP 403 playback_unavailable; лицензия без токена: HTTP ${String(licence)}`,
      );
    } finally {
      await page.close();
    }
  }

  /** Плеер записи без `drmauthtoken` на странице sachkov.dev: так его видит Kinescope у гостя. */
  async function tokenlessLicence(
    page: Page,
    embedLocator: string,
  ): Promise<number | null> {
    const source = new URL(embedLocator);
    source.searchParams.set("dnt", "1");
    const licences = watchLicences(page);
    try {
      await page.evaluate((src) => {
        const frame = document.createElement("iframe");
        frame.src = src;
        frame.allow = "autoplay; encrypted-media";
        frame.dataset["passTokenlessPlayer"] = "";
        frame.style.cssText =
          "position:fixed;inset:0;width:640px;height:360px;z-index:2147483647";
        document.body.append(frame);
      }, source.href);
      await expect(
        page.frameLocator("[data-pass-tokenless-player]").locator("video"),
      ).toBeAttached({ timeout: tokenlessLicenceBudgetMs });
      await page.locator("[data-pass-tokenless-player]").click();
      return await licences.outcome(tokenlessLicenceBudgetMs);
    } finally {
      licences.stop();
    }
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
      "billing_productPrices_list",
      { operationId: randomUUID(), productId: productA.id, limit: 1 },
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
