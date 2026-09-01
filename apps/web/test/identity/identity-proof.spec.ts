import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { z } from "zod";

const webBaseUrl = requiredEnvironment("WEB_BASE_URL");
const backendBaseUrl = requiredEnvironment("BACKEND_BASE_URL");
const logtoEndpoint = requiredEnvironment("LOGTO_ENDPOINT");
const mailpitEndpoint = `http://127.0.0.1:${requiredEnvironment("IDENTITY_PROOF_MAILPIT_PORT")}`;
const composeFile = resolve("../../infra/identity/logto/compose.yaml");
const execFileAsync = promisify(execFile);
const rateLimitMessage = "Слишком много писем. Пожалуйста, повторите попытку позже.";
const messagesSchema = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      Snippet: z.string(),
      To: z.array(z.object({ Address: z.string() })),
    }),
  ),
});

test.describe.serial("issue 116 pinned Logto proof", () => {
  test("prints immutable runtime lineage without credentials", async () => {
    const [versionsSource, patch] = await Promise.all([
      readFile("../../infra/identity/logto/versions.json", "utf8"),
      readFile("../../infra/identity/logto/patches/issue-116-logto-proof.patch"),
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
      Array.from({ length: 12 }, () => sendFromFreshFlow(browser, recipient)),
    );
    const delivered = attempts.filter(({ outcome }) => outcome === "delivered");
    const limited = attempts.filter(({ outcome }) => outcome === "limited");

    expect(delivered).toHaveLength(10);
    expect(limited).toHaveLength(2);
    await expectDeliveryCount(recipient, 10);
    for (const attempt of limited) assertGenericRateLimit(attempt);

    const firstDelivered = delivered[0];
    if (firstDelivered === undefined) throw new Error("Expected one delivered flow");
    await firstDelivered.page.reload();
    await expectDeliveryCount(recipient, 10);
    await firstDelivered.page.goBack();
    const backAttempt = await submitEmailFromCurrentPage(firstDelivered.page, recipient);
    expect(backAttempt.status()).toBe(429);
    expect(await backAttempt.text()).toContain(rateLimitMessage);
    await expectDeliveryCount(recipient, 10);

    const caseVariant = await sendFromFreshFlow(browser, "  Parallel-116@Example.Test ");
    expect(caseVariant.outcome).toBe("limited");
    expect(caseVariant.responseText).toContain(rateLimitMessage);

    const afterCap = await Promise.all(
      Array.from({ length: 4 }, () => sendFromFreshFlow(browser, recipient)),
    );
    expect(afterCap.every(({ outcome }) => outcome === "limited")).toBe(true);
    await expectDeliveryCount(recipient, 10);
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
      Array.from({ length: 10 }, () => sendFromFreshFlow(browser, conservativeRecipient)),
    );
    expect(exhausted.every(({ outcome }) => outcome === "provider-failed")).toBe(true);
    await startService("mailpit");
    await waitForEndpoint(`${mailpitEndpoint}/api/v1/messages`);
    const blockedAfterRecovery = await sendFromFreshFlow(browser, conservativeRecipient);
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
    await page.goto("/callback?code=proof-code-canary-116&state=proof-state-canary-116");
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
      if (url.origin === webBaseUrl && url.pathname === "/callback") callbackUrl = url.href;
    });
    await beginSignIn(page, recipient);
    const code = await waitForCode(recipient);
    await enterCode(page, code);
    await page.waitForURL((url) => url.origin === webBaseUrl);
    if (new URL(page.url()).searchParams.get("authentication") === "failed") {
      throw new Error("Real Logto callback failed");
    }
    await expect(page).toHaveURL(`${webBaseUrl}/`);
    await expect(
      page.getByRole("button", { exact: true, name: "Выйти" }),
    ).toBeVisible();
    expect(callbackUrl).toContain("/callback?");

    const cookies = await page.context().cookies();
    expect(cookies.filter(({ name }) => name.startsWith("logto_"))).toHaveLength(1);
    expect(cookies.some(({ name }) => name === "inside_session" || name === "inside_signin")).toBe(
      false,
    );

    await page.goto(callbackUrl);
    await expect(page).toHaveURL(/authentication=failed/u);
    const replayStatus = await page.request.get("/auth/status");
    await expect(replayStatus.json()).resolves.toEqual({ state: "guest" });

    const recovery = await browser.newPage({ ignoreHTTPSErrors: true });
    await beginSignIn(recovery, recipient);
    await enterCode(recovery, await waitForCode(recipient, 2));
    await expect(recovery).toHaveURL(`${webBaseUrl}/`);

    await recovery.waitForTimeout(61_000);
    await stopService("logto");
    const unavailable = await recovery.request.get("/auth/status");
    await expect(unavailable.json()).resolves.toEqual({ state: "unavailable" });
    await startService("logto");
    await waitForEndpoint(`${logtoEndpoint}/oidc/.well-known/openid-configuration`);
    const refreshed = await recovery.request.get("/auth/status");
    await expect(refreshed.json()).resolves.toEqual({ state: "authenticated" });

    const appSession = (await recovery.context().cookies()).find(
      ({ domain, name }) =>
        domain === new URL(webBaseUrl).hostname && name.startsWith("logto_"),
    );
    if (appSession === undefined) throw new Error("Expected the Logto BFF session cookie");
    await recovery.context().clearCookies({
      domain: appSession.domain,
      name: appSession.name,
      path: appSession.path,
    });
    await recovery.goto(webBaseUrl);
    await recovery.locator('button:visible', { hasText: "Войти" }).click();
    await recovery.waitForURL((url) => url.origin === webBaseUrl);
    expect(new URL(recovery.url()).searchParams.get("authentication")).not.toBe("failed");
    await expect(
      recovery.getByRole("button", { exact: true, name: "Выйти" }),
    ).toBeVisible();

    const existingAccountAttempts = await Promise.all(
      Array.from({ length: 9 }, () => sendFromFreshFlow(browser, recipient)),
    );
    expect(existingAccountAttempts.filter(({ outcome }) => outcome === "delivered")).toHaveLength(8);
    const existingAccountLimited = existingAccountAttempts.filter(
      ({ outcome }) => outcome === "limited",
    );
    expect(existingAccountLimited).toHaveLength(1);
    const existingLimited = existingAccountLimited[0];
    if (existingLimited === undefined) throw new Error("Expected an existing-Account rate limit");
    assertGenericRateLimit(existingLimited);
    await expectDeliveryCount(recipient, 10);
    await closeAttempts(existingAccountAttempts);
    await recovery.close();
  });
});

type SendOutcome = "delivered" | "limited" | "provider-failed";
interface SendAttempt {
  context: BrowserContext;
  page: Page;
  outcome: SendOutcome;
  status: number;
  responseText: string;
  visibleText: string;
}

async function sendFromFreshFlow(browser: Browser, email: string): Promise<SendAttempt> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const response = await beginSignIn(page, email);
  const outcome: SendOutcome = response.status() === 429
    ? "limited"
    : response.ok()
      ? "delivered"
      : "provider-failed";
  const responseText = await response.text();
  if (outcome === "limited") {
    await expect(page.getByText(rateLimitMessage)).toBeVisible();
  }
  const visibleText = await page.locator("body").innerText();
  return { context, page, outcome, status: response.status(), responseText, visibleText };
}

function assertGenericRateLimit(attempt: SendAttempt): void {
  expect(attempt.status).toBe(429);
  expect(attempt.responseText).toContain(rateLimitMessage);
  expect(`${attempt.responseText}\n${attempt.visibleText}`).not.toMatch(
    /429|recipient|quota|example\.test/iu,
  );
}

async function beginSignIn(page: Page, email: string) {
  await page.goto(webBaseUrl);
  return submitEmailFromCurrentPage(page, email);
}

async function submitEmailFromCurrentPage(page: Page, email: string) {
  if (new URL(page.url()).origin === webBaseUrl) {
    await page.locator('button:visible', { hasText: "Войти" }).click();
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
  const inputs = page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]');
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
  const response = await fetch(`${mailpitEndpoint}/api/v1/messages`, { method: "DELETE" });
  expect(response.ok).toBe(true);
}

async function expectDeliveryCount(email: string, count: number): Promise<void> {
  await expect.poll(async () => (await messages()).filter((message) =>
    message.To.some(({ Address }) => Address.toLowerCase() === email.trim().toLowerCase()),
  ).length).toBe(count);
}

async function waitForCode(email: string, expectedDeliveryCount = 1): Promise<string> {
  await expectDeliveryCount(email, expectedDeliveryCount);
  const message = (await messages()).find((candidate) =>
    candidate.To.some(({ Address }) => Address.toLowerCase() === email.toLowerCase()),
  );
  const code = /\b(\d{6})\b/u.exec(message?.Snippet ?? "")?.[1];
  if (code === undefined) throw new Error("Mailpit did not expose a six-digit proof code");
  return code;
}

async function stopService(service: "logto" | "mailpit"): Promise<void> {
  await execFileAsync("docker", ["compose", "-f", composeFile, "stop", "--timeout", "1", service]);
}

async function startService(service: "logto" | "mailpit"): Promise<void> {
  await execFileAsync("docker", ["compose", "-f", composeFile, "start", service]);
}

async function waitForEndpoint(endpoint: string): Promise<void> {
  await expect.poll(() => fetch(endpoint).then((response) => response.ok).catch(() => false), {
    timeout: 30_000,
  }).toBe(true);
}

async function closeAttempts(attempts: SendAttempt[]): Promise<void> {
  await Promise.all(attempts.map(({ context }) => context.close()));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}
