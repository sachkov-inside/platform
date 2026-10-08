import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";

import { waitPastAccessTokenExpiry } from "./access-token-expiry";
import { requiredEnvironment } from "./environment";

let webBaseUrl: string;
let backendBaseUrl: string;
let logtoEndpoint: string;
let mailpitEndpoint: string;
const composeFile = resolve("../../infra/identity/logto/compose.yaml");
const execFileAsync = promisify(execFile);
/** Потолок писем с кодом на одного получателя за окно Logto (#116). */
const recipientCodesPerWindow = 10;
const rateLimitMessage =
  "Слишком много писем. Пожалуйста, повторите попытку позже.";
const messagesSchema = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      Snippet: z.string(),
      To: z.array(z.object({ Address: z.string() })),
    }),
  ),
});

test.beforeAll(() => {
  webBaseUrl = requiredEnvironment("WEB_BASE_URL");
  backendBaseUrl = requiredEnvironment("BACKEND_BASE_URL");
  logtoEndpoint = requiredEnvironment("LOGTO_ENDPOINT");
  mailpitEndpoint = `http://127.0.0.1:${requiredEnvironment("IDENTITY_PROOF_MAILPIT_PORT")}`;
});

test.describe.serial("issue 116 pinned Logto proof", () => {
  test("prints immutable runtime lineage without credentials", async () => {
    const [versionsSource, patch] = await Promise.all([
      readFile("../../infra/identity/logto/versions.json", "utf8"),
      readFile(
        "../../infra/identity/logto/patches/issue-116-logto-proof.patch",
      ),
    ]);
    const versions = JSON.parse(versionsSource) as unknown;
    process.stdout.write(
      `${JSON.stringify({
        patchSha256: createHash("sha256").update(patch).digest("hex"),
        runtime: versions,
      })}\n`,
    );
  });

  test("bounds parallel, reload, back and new-browser sends by normalized recipient", async ({
    browser,
  }) => {
    await clearMailpit();
    const recipient = "parallel-116@example.test";
    const attempts = await Promise.all(
      Array.from({ length: recipientCodesPerWindow + 2 }, () =>
        sendFromFreshFlow(browser, recipient),
      ),
    );
    const delivered = attempts.filter(({ outcome }) => outcome === "delivered");
    const limited = attempts.filter(({ outcome }) => outcome === "limited");

    expect(delivered).toHaveLength(recipientCodesPerWindow);
    expect(limited).toHaveLength(2);
    await expectDeliveryCount(recipient, recipientCodesPerWindow);
    for (const attempt of limited) assertGenericRateLimit(attempt);

    const firstDelivered = delivered[0];
    if (firstDelivered === undefined)
      throw new Error("Expected one delivered flow");
    await firstDelivered.page.reload();
    await expectDeliveryCount(recipient, recipientCodesPerWindow);
    await firstDelivered.page.goBack();
    const backAttempt = await submitEmailFromCurrentPage(
      firstDelivered.page,
      recipient,
    );
    expect(backAttempt.status()).toBe(429);
    expect(await backAttempt.text()).toContain(rateLimitMessage);
    await expectDeliveryCount(recipient, recipientCodesPerWindow);

    const caseVariant = await sendFromFreshFlow(
      browser,
      "  Parallel-116@Example.Test ",
    );
    expect(caseVariant.outcome).toBe("limited");
    expect(caseVariant.responseText).toContain(rateLimitMessage);

    const afterCap = await Promise.all(
      Array.from({ length: 4 }, () => sendFromFreshFlow(browser, recipient)),
    );
    expect(afterCap.every(({ outcome }) => outcome === "limited")).toBe(true);
    await expectDeliveryCount(recipient, recipientCodesPerWindow);
    await closeAttempts([...attempts, caseVariant, ...afterCap]);
  });

  test("fails closed during SMTP outage and recovers with a conservative reservation", async ({
    browser,
  }) => {
    await clearMailpit();
    const recipient = "provider-outage-116@example.test";
    await stopService("mailpit");
    const failed = await sendFromFreshFlow(browser, recipient);
    expect(failed.outcome).toBe("provider-failed");
    expect(`${failed.responseText}\n${failed.visibleText}`).not.toMatch(
      /ECONNREFUSED|mailpit|SMTP|example\.test/iu,
    );
    await startService("mailpit");
    await waitForEndpoint(`${mailpitEndpoint}/api/v1/messages`);
    const recovered = await sendFromFreshFlow(browser, recipient);
    expect(recovered.outcome).toBe("delivered");
    await expectDeliveryCount(recipient, 1);
    await closeAttempts([failed, recovered]);

    await clearMailpit();
    const conservativeRecipient = "ambiguous-provider-116@example.test";
    await stopService("mailpit");
    const exhausted = await Promise.all(
      Array.from({ length: 10 }, () =>
        sendFromFreshFlow(browser, conservativeRecipient),
      ),
    );
    expect(
      exhausted.every(({ outcome }) => outcome === "provider-failed"),
    ).toBe(true);
    await startService("mailpit");
    await waitForEndpoint(`${mailpitEndpoint}/api/v1/messages`);
    const blockedAfterRecovery = await sendFromFreshFlow(
      browser,
      conservativeRecipient,
    );
    assertGenericRateLimit(blockedAfterRecovery);
    await expectDeliveryCount(conservativeRecipient, 0);
    await closeAttempts([...exhausted, blockedAfterRecovery]);
  });

  test("rejects wrong callback path, replay and invalid refresh without a second Account", async ({
    browser,
    page,
  }) => {
    await page.goto(
      "/callback?error=access_denied&error_description=provider-payload-canary-116&state=proof-state-canary-116",
    );
    await expect(page).toHaveURL(/authentication=failed/u);
    await page.goto(
      "/callback?code=proof-code-canary-116&state=proof-state-canary-116",
    );
    await expect(page).toHaveURL(/authentication=failed/u);
    const invalidJwt = await page.request.post(`${backendBaseUrl}/accounts`, {
      headers: { authorization: "Bearer proof-jwt-canary-116" },
    });
    expect(invalidJwt.status()).toBe(401);

    const wrongPath = await page.goto(
      "/callback/wrong?code=proof-code-canary-116&state=proof-state-canary-116",
    );
    expect(wrongPath?.status()).toBe(404);

    await clearMailpit();
    const recipient = "account-116@example.test";
    let callbackUrl = "";
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === webBaseUrl && url.pathname === "/callback")
        callbackUrl = url.href;
    });
    await beginSignIn(page, recipient);
    const code = await waitForCode(recipient);
    await enterCode(page, code);
    await page.waitForURL((url) => url.origin === webBaseUrl);
    if (new URL(page.url()).searchParams.get("authentication") === "failed") {
      throw new Error("Real Logto callback failed");
    }
    // Первый вход открывает экран условий и возвращает туда, куда человек шёл: на Главную.
    await expect(page).toHaveURL(`${webBaseUrl}/welcome?returnTo=%2F`);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Принять условия и продолжить" })
      .click();
    await expect(page).toHaveURL(`${webBaseUrl}/`);
    await expect(
      page.getByRole("button", { exact: true, name: "Аккаунт" }),
    ).toBeVisible();
    expect(callbackUrl).toContain("/callback?");
    const accountId = await signedInAccountId(page);

    const cookies = await page.context().cookies();
    expect(
      cookies.filter(({ name }) => name.startsWith("logto_")),
    ).toHaveLength(1);
    expect(
      cookies.some(
        ({ name }) => name === "inside_session" || name === "inside_signin",
      ),
    ).toBe(false);

    await page.goto(callbackUrl);
    await expect(page).toHaveURL(/authentication=failed/u);
    const replayStatus = await page.request.get("/auth/status");
    await expect(replayStatus.json()).resolves.toEqual({
      accountId: null,
      canManageMaterials: false,
      state: "guest",
    });

    const recovery = await browser.newPage({ ignoreHTTPSErrors: true });
    await beginSignIn(recovery, recipient);
    await enterCode(recovery, await waitForCode(recipient, 2));
    await expect(recovery).toHaveURL(`${webBaseUrl}/`);
    expect(await signedInAccountId(recovery)).toBe(accountId);
    // deterministic-test-allow wall-clock: Legacy clock read; fixed domain or monotonic clock migration is tracked in #1177.
    const signedInAt = Date.now();

    await waitPastAccessTokenExpiry(recovery, signedInAt);
    await stopService("logto");
    const unavailable = await recovery.request.get("/auth/status");
    await expect(unavailable.json()).resolves.toEqual({
      accountId: null,
      canManageMaterials: false,
      state: "unavailable",
    });
    expect((await recovery.request.get("/api/account")).status()).toBe(503);
    await startService("logto");
    await waitForEndpoint(
      `${logtoEndpoint}/oidc/.well-known/openid-configuration`,
    );
    const refreshed = await recovery.request.get("/auth/status");
    await expect(refreshed.json()).resolves.toMatchObject({
      state: "authenticated",
    });

    const appSession = (await recovery.context().cookies()).find(
      ({ domain, name }) =>
        domain === new URL(webBaseUrl).hostname && name.startsWith("logto_"),
    );
    if (appSession === undefined)
      throw new Error("Expected the Logto BFF session cookie");
    await recovery.context().clearCookies({
      domain: appSession.domain,
      name: appSession.name,
      path: appSession.path,
    });
    // Вход всегда явный (`prompt: [Prompt.Login, Prompt.Consent]`, #372): без cookie BFF
    // человек снова вводит код и попадает в тот же Account.
    await beginSignIn(recovery, recipient);
    const codesBeforeWave = 3;
    await enterCode(recovery, await waitForCode(recipient, codesBeforeWave));
    await expect(recovery).toHaveURL(`${webBaseUrl}/`);
    await expect(
      recovery.getByRole("button", { exact: true, name: "Аккаунт" }),
    ).toBeVisible();
    expect(await signedInAccountId(recovery)).toBe(accountId);

    await proveLearnerRefresh(recovery);
    expect(await signedInAccountId(recovery)).toBe(accountId);

    const wave = 9;
    const existingAccountAttempts = await Promise.all(
      Array.from({ length: wave }, () => sendFromFreshFlow(browser, recipient)),
    );
    const deliveredInWave = recipientCodesPerWindow - codesBeforeWave;
    expect(
      existingAccountAttempts.filter(({ outcome }) => outcome === "delivered"),
    ).toHaveLength(deliveredInWave);
    const existingAccountLimited = existingAccountAttempts.filter(
      ({ outcome }) => outcome === "limited",
    );
    expect(existingAccountLimited).toHaveLength(wave - deliveredInWave);
    for (const limited of existingAccountLimited)
      assertGenericRateLimit(limited);
    await expectDeliveryCount(recipient, recipientCodesPerWindow);
    await closeAttempts(existingAccountAttempts);

    // Сессия без кешированного access token и с недействительным refresh grant не открывает Account.
    const { PersistKey, unwrapSession, wrapSession } =
      await import("@logto/node");
    const invalidSession = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const currentSession = (await recovery.context().cookies()).find(
      ({ domain, name }) =>
        domain === new URL(webBaseUrl).hostname && name === appSession.name,
    );
    if (currentSession === undefined) throw new Error("Expected a BFF session");
    const secret = requiredEnvironment("LOGTO_COOKIE_SECRET");
    const session = await unwrapSession(
      decodeURIComponent(currentSession.value),
      secret,
    );
    expect(typeof session.idToken).toBe("string");
    expect(typeof session.refreshToken).toBe("string");
    delete session.accessToken;
    const refreshToken = session[PersistKey.RefreshToken];
    if (refreshToken === undefined) throw new Error("Expected a refresh token");
    const invalidRefreshToken =
      (refreshToken.startsWith("A") ? "B" : "A") + refreshToken.slice(1);
    session[PersistKey.RefreshToken] = invalidRefreshToken;
    const rejectedGrant = await recovery.request.post(
      `${logtoEndpoint}/oidc/token`,
      {
        headers: {
          authorization: `Basic ${Buffer.from(
            `${requiredEnvironment("LOGTO_APP_ID")}:${requiredEnvironment("LOGTO_APP_SECRET")}`,
          ).toString("base64")}`,
        },
        form: {
          grant_type: "refresh_token",
          refresh_token: invalidRefreshToken,
        },
      },
    );
    expect(rejectedGrant.status()).toBe(400);
    await expect(rejectedGrant.json()).resolves.toMatchObject({
      error: "invalid_grant",
    });
    await invalidSession.addCookies([
      {
        ...currentSession,
        value: encodeURIComponent(await wrapSession(session, secret)),
      },
    ]);
    // Отвергнутый refresh grant кончает сессию: Account закрыт как для гостя, cookie BFF снята (#1005).
    const closedAccount = await invalidSession.request.get(
      `${webBaseUrl}/api/account`,
    );
    expect(closedAccount.status()).toBe(401);
    expect(await closedAccount.text()).toBe("");
    const expiredSession = closedAccount
      .headersArray()
      .find(
        ({ name, value }) =>
          name.toLowerCase() === "set-cookie" &&
          value.startsWith(`${appSession.name}=;`),
      );
    expect(expiredSession?.value).toMatch(/max-age=0/i);
    expect(
      (await invalidSession.cookies(webBaseUrl)).some(
        ({ name }) => name === appSession.name,
      ),
    ).toBe(false);
    await invalidSession.addCookies([
      {
        ...currentSession,
        value: encodeURIComponent(await wrapSession(session, secret)),
      },
    ]);
    const invalidRefresh = await invalidSession.request.get(
      `${webBaseUrl}/auth/status`,
    );
    await expect(invalidRefresh.json()).resolves.toMatchObject({
      state: "guest",
      accountId: null,
      canManageMaterials: false,
    });
    expect(
      (await invalidSession.cookies(webBaseUrl)).some(
        ({ name }) => name === appSession.name,
      ),
    ).toBe(false);
    expect(
      (await invalidSession.request.get(`${webBaseUrl}/api/account`)).status(),
    ).toBe(401);
    await invalidSession.close();

    await recovery.goto(webBaseUrl);
    await recovery
      .getByRole("button", {
        name: "Закрыть подключение Telegram",
        exact: true,
      })
      .click();
    await recovery
      .getByRole("button", { name: "Аккаунт", exact: true })
      .click();
    const providerLogout = recovery.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.origin === logtoEndpoint && url.pathname === "/oidc/session/end"
      );
    });
    const signOutResponse = recovery.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url() === `${webBaseUrl}/auth/sign-out`,
    );
    await recovery
      .getByRole("menuitem", { name: "Выйти", exact: true })
      .click();
    const signOut = await signOutResponse;
    expect(signOut.status()).toBe(200);
    expect(await signOut.headerValue("clear-site-data")).toBe('"storage"');
    expect((await providerLogout).method()).toBe("GET");
    await expect(recovery).toHaveURL(`${webBaseUrl}/`);
    const signedOut = await recovery.request.get("/auth/status");
    await expect(signedOut.json()).resolves.toMatchObject({
      state: "guest",
      accountId: null,
    });
    expect((await recovery.request.get("/api/account")).status()).toBe(401);
    await recovery.close();
  });
});

/** Публичный MCP клиент получает offline_access и обновляет токен против настоящего server fork. */
async function proveLearnerRefresh(page: Page): Promise<void> {
  const {
    default: LogtoClient,
    PersistKey,
    Prompt,
  } = await import("@logto/node");
  const resource = requiredEnvironment("IDENTITY_PROOF_LEARNER_MCP_URL");
  const publicClientId = requiredEnvironment(
    "IDENTITY_PROOF_LEARNER_CLIENT_ID",
  );
  const storage = new Map<string, string>();
  const tokenGrants: (string | null)[] = [];
  let authorizationUrl = "";
  const client = new LogtoClient(
    {
      appId: publicClientId,
      endpoint: logtoEndpoint,
      resources: [resource],
      scopes: ["learning:read"],
    },
    {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname === "/oidc/token") {
          tokenGrants.push(
            new URLSearchParams(await request.clone().text()).get("grant_type"),
          );
        }
        return fetch(request);
      },
      navigate: (url) => {
        authorizationUrl = url;
      },
      storage: {
        getItem: (key) => Promise.resolve(storage.get(key) ?? null),
        setItem: (key, value) => {
          storage.set(key, value);
          return Promise.resolve();
        },
        removeItem: (key) => {
          storage.delete(key);
          return Promise.resolve();
        },
      },
    },
  );
  // Native MCP clients receive OAuth callbacks on an actual loopback HTTP listener.
  // Do not intercept Logto's navigation: the same browser just exercised provider restart.
  const callback = Promise.withResolvers<string>();
  const server = createServer((request, response) => {
    response.end("MCP callback received");
    callback.resolve(request.url ?? "");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a loopback callback port");
    }
    const redirectUri = `http://127.0.0.1:${String(address.port)}/callback`;
    await client.signIn({ redirectUri, prompt: [Prompt.Consent] });
    expect(
      new URL(authorizationUrl).searchParams.get("scope")?.split(" "),
    ).toContain("offline_access");
    await page.goto(authorizationUrl);
    // A first-party Native client can return directly; third-party consent renders a button.
    if (new URL(page.url()).origin === logtoEndpoint) {
      await page
        .getByRole("button", { name: "Авторизовать", exact: true })
        .click();
    }
    await expect(page).toHaveURL(
      (url) =>
        url.origin === new URL(redirectUri).origin &&
        url.pathname === "/callback",
    );
    await client.handleSignInCallback(
      new URL(await callback.promise, redirectUri).href,
    );
    expect(storage.has(PersistKey.RefreshToken)).toBe(true);
    const account = await client.getIdTokenClaims();
    expect(
      tokenGrants.filter((grant) => grant === "authorization_code"),
    ).toHaveLength(1);
    const firstToken = await client.getAccessToken(resource);
    await expectLearnerInitialization(page, resource, firstToken);
    // Публичный метод SDK очищает кеш access token; следующее чтение требует refresh grant.
    const refreshGrantsBefore = tokenGrants.filter(
      (grant) => grant === "refresh_token",
    ).length;
    await client.clearAccessToken();
    const refreshedToken = await client.getAccessToken(resource);
    expect(
      tokenGrants.filter((grant) => grant === "refresh_token"),
    ).toHaveLength(refreshGrantsBefore + 1);
    expect((await client.getIdTokenClaims()).sub).toBe(account.sub);
    await expectLearnerInitialization(page, resource, refreshedToken);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      }),
    );
  }
  await page.goto(webBaseUrl);
}

async function expectLearnerInitialization(
  page: Page,
  resource: string,
  token: string,
): Promise<void> {
  const response = await page.request.post(resource, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "sdk-proof-992", version: "1" },
      },
    },
  });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('"serverInfo"');
}

type SendOutcome = "delivered" | "limited" | "provider-failed";
interface SendAttempt {
  context: BrowserContext;
  page: Page;
  outcome: SendOutcome;
  status: number;
  responseText: string;
  visibleText: string;
}

async function sendFromFreshFlow(
  browser: Browser,
  email: string,
): Promise<SendAttempt> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const response = await beginSignIn(page, email);
  const outcome: SendOutcome =
    response.status() === 429
      ? "limited"
      : response.ok()
        ? "delivered"
        : "provider-failed";
  const responseText = await response.text();
  if (outcome === "limited") {
    await expect(page.getByText(rateLimitMessage)).toBeVisible();
  }
  const visibleText = await page.locator("body").innerText();
  return {
    context,
    page,
    outcome,
    status: response.status(),
    responseText,
    visibleText,
  };
}

function assertGenericRateLimit(attempt: SendAttempt): void {
  expect(attempt.status).toBe(429);
  expect(attempt.responseText).toContain(rateLimitMessage);
  expect(`${attempt.responseText}\n${attempt.visibleText}`).not.toMatch(
    /429|recipient|quota|example\.test/iu,
  );
}

/** Account, в который привёл вход: его называет `/auth/status` вошедшей сессии. */
async function signedInAccountId(page: Page): Promise<string> {
  const status = await page.request.get("/auth/status");
  return z
    .object({ accountId: z.string(), state: z.literal("authenticated") })
    .parse(await status.json()).accountId;
}

async function beginSignIn(page: Page, email: string) {
  await page.goto(webBaseUrl);
  return submitEmailFromCurrentPage(page, email);
}

async function submitEmailFromCurrentPage(page: Page, email: string) {
  if (new URL(page.url()).origin === webBaseUrl) {
    await page.locator("button:visible", { hasText: "Войти" }).click();
  }
  await expect.poll(() => new URL(page.url()).origin).toBe(logtoEndpoint);
  const emailInput = page.locator('input[type="email"]');
  await emailInput.fill(email);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/experience/") &&
      [200, 204, 400, 429, 500, 503].includes(response.status()),
  );
  await page.locator('button[type="submit"]').click();
  return responsePromise;
}

async function enterCode(page: Page, code: string): Promise<void> {
  const inputs = page.locator(
    'input[inputmode="numeric"], input[autocomplete="one-time-code"]',
  );
  await expect(inputs.first()).toBeVisible();
  const count = await inputs.count();
  if (count === 1) {
    await inputs.fill(code);
  } else {
    expect(count).toBe(6);
    for (let index = 0; index < code.length; index += 1) {
      await inputs.nth(index).fill(code.charAt(index));
    }
  }
  const submit = page.locator('button[type="submit"]');
  if (await submit.isVisible()) await submit.click();
}

async function messages() {
  const response = await fetch(`${mailpitEndpoint}/api/v1/messages`);
  expect(response.ok).toBe(true);
  return messagesSchema.parse(await response.json()).messages;
}

async function clearMailpit(): Promise<void> {
  const response = await fetch(`${mailpitEndpoint}/api/v1/messages`, {
    method: "DELETE",
  });
  expect(response.ok).toBe(true);
}

async function expectDeliveryCount(
  email: string,
  count: number,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await messages()).filter((message) =>
          message.To.some(
            ({ Address }) =>
              Address.toLowerCase() === email.trim().toLowerCase(),
          ),
        ).length,
    )
    .toBe(count);
}

async function waitForCode(
  email: string,
  expectedDeliveryCount = 1,
): Promise<string> {
  await expectDeliveryCount(email, expectedDeliveryCount);
  const message = (await messages()).find((candidate) =>
    candidate.To.some(
      ({ Address }) => Address.toLowerCase() === email.toLowerCase(),
    ),
  );
  const code = /\b(\d{6})\b/u.exec(message?.Snippet ?? "")?.[1];
  if (code === undefined)
    throw new Error("Mailpit did not expose a six-digit proof code");
  return code;
}

async function stopService(service: "logto" | "mailpit"): Promise<void> {
  await execFileAsync("docker", [
    "compose",
    "-f",
    composeFile,
    "stop",
    "--timeout",
    "1",
    service,
  ]);
}

async function startService(service: "logto" | "mailpit"): Promise<void> {
  await execFileAsync("docker", [
    "compose",
    "-f",
    composeFile,
    "start",
    service,
  ]);
}

async function waitForEndpoint(endpoint: string): Promise<void> {
  await expect
    .poll(
      () =>
        fetch(endpoint)
          .then((response) => response.ok)
          .catch(() => false),
      {
        timeout: 30_000,
      },
    )
    .toBe(true);
}

async function closeAttempts(attempts: SendAttempt[]): Promise<void> {
  await Promise.all(attempts.map(({ context }) => context.close()));
}
