// @ts-check
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
import { z } from "zod";

const config = z
  .object({
    PROFILE_PROOF_ENDPOINT: z.url(),
    PROFILE_PROOF_MAIL: z.url(),
    PROFILE_PROOF_CALLBACK: z.url(),
    PROFILE_PROOF_EMAIL: z.email(),
    PROFILE_PROOF_APP_ID: z.string(),
    PROFILE_PROOF_APP_SECRET: z.string(),
    PROFILE_PROOF_SUBJECT: z.string(),
    PROFILE_PROOF_ONE_TIME_TOKEN: z.string().min(1),
    PROFILE_PROOF_LEGACY_EMAIL: z.email(),
    PROFILE_PROOF_LEGACY_SUBJECT: z.string().min(1),
  })
  .parse(process.env);
const endpoint = config.PROFILE_PROOF_ENDPOINT;
const redirect = config.PROFILE_PROOF_CALLBACK;
const state = randomBytes(16).toString("hex");
const verifier = randomBytes(32).toString("base64url");
/** @type {PromiseWithResolvers<URL>} */
const callback = Promise.withResolvers();
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", redirect);
  response
    .writeHead(200, { "content-type": "text/plain" })
    .end("Profile proof complete");
  callback.resolve(url);
});
server.listen(Number(new URL(redirect).port), "127.0.0.1");
await once(server, "listening");
const browser = await chromium.launch({ headless: true });
const interrupted = () => {
  void browser.close();
  server.close();
};
process.once("SIGTERM", interrupted);
process.once("SIGINT", interrupted);
const messagesSchema = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      Snippet: z.string(),
      To: z.array(z.object({ Address: z.string() })),
    }),
  ),
});
async function messages() {
  const response = await fetch(`${config.PROFILE_PROOF_MAIL}/api/v1/messages`);
  return messagesSchema.parse(await response.json()).messages;
}
/**
 * @param {import("@playwright/test").Page} page
 * @param {string} email
 */
async function enterEmailCode(page, email) {
  const previous = new Set((await messages()).map((message) => message.ID));
  await page.locator('input[type="email"]').fill(email);
  await page.locator('button[type="submit"]').click();
  const inputs = page.locator(
    'input[inputmode="numeric"], input[autocomplete="one-time-code"]',
  );
  await inputs.first().waitFor();
  const readCode = async () => {
    const delivered = (await messages()).find(
      (message) =>
        !previous.has(message.ID) &&
        message.To.some((recipient) => recipient.Address === email),
    );
    return /\b([0-9]{6})\b/u.exec(delivered?.Snippet ?? "")?.[1];
  };
  await expect.poll(readCode).toMatch(/^[0-9]{6}$/u);
  const code = await readCode();
  assert.ok(code, "Sign-in email was not delivered");
  if ((await inputs.count()) === 1) await inputs.fill(code);
  else
    for (let index = 0; index < code.length; index++) {
      await inputs.nth(index).fill(code.charAt(index));
    }
  const submit = page.locator('button[type="submit"]');
  if (await submit.isVisible()) await submit.click();
}
/**
 * @param {URL} returned
 * @param {string} email
 * @param {string} subject
 */
async function assertEmailIdentity(returned, email, subject) {
  assert.equal(returned.searchParams.get("state"), state);
  const authorizationCode = returned.searchParams.get("code");
  assert.ok(authorizationCode);
  const response = await fetch(new URL("/oidc/token", endpoint), {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${config.PROFILE_PROOF_APP_ID}:${config.PROFILE_PROOF_APP_SECRET}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: redirect,
      code_verifier: verifier,
    }),
  });
  const token = z
    .object({ access_token: z.string() })
    .parse(await response.json());
  assert.equal(response.status, 200);
  const info = await fetch(new URL("/oidc/me", endpoint), {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const user = z
    .object({ sub: z.string(), email: z.email() })
    .parse(await info.json());
  assert.equal(user.sub, subject);
  assert.equal(user.email, email);
}
try {
  const authorization = new URL("/oidc/auth", endpoint);
  authorization.search = new URLSearchParams({
    client_id: config.PROFILE_PROOF_APP_ID,
    redirect_uri: redirect,
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "login",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  const telegramAuthorization = new URL(authorization);
  telegramAuthorization.searchParams.set(
    "direct_sign_in",
    "social:inside-telegram",
  );
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto(telegramAuthorization.href);
  await page.waitForURL(new URL("/api/inside-telegram", endpoint).href);
  await page.getByRole("link", { name: "Войти по почте" }).click();
  await enterEmailCode(page, config.PROFILE_PROOF_EMAIL);
  const deadline = AbortSignal.timeout(30_000);
  const onTimeout = () => {
    callback.reject(new Error("Email sign-in callback timed out"));
  };
  deadline.addEventListener("abort", onTimeout, { once: true });
  let returned;
  try {
    returned = await callback.promise;
  } finally {
    deadline.removeEventListener("abort", onTimeout);
  }
  assert.ok(returned instanceof URL);
  await assertEmailIdentity(
    returned,
    config.PROFILE_PROOF_EMAIL,
    config.PROFILE_PROOF_SUBJECT,
  );

  const legacy = await browser.newPage();
  await legacy.goto(authorization.href);
  await enterEmailCode(legacy, config.PROFILE_PROOF_LEGACY_EMAIL);
  await legacy.waitForURL(redirect + "?*");
  await assertEmailIdentity(
    new URL(legacy.url()),
    config.PROFILE_PROOF_LEGACY_EMAIL,
    config.PROFILE_PROOF_LEGACY_SUBJECT,
  );

  const unknown = await browser.newPage();
  await unknown.goto(authorization.href);
  await enterEmailCode(unknown, "unknown-profile@example.test");
  await expect(unknown.getByRole("dialog")).toBeVisible();
  assert.equal(new URL(unknown.url()).origin, endpoint);
  const registration = await browser.newPage();
  await registration.goto(authorization.href);
  const beginRegistration = await registration.request.put(
    new URL("/api/experience", endpoint).href,
    { data: { interactionEvent: "Register" } },
  );
  assert.equal(beginRegistration.status(), 204);
  const withoutProof = await registration.request.post(
    new URL("/api/experience/identification", endpoint).href,
    { data: {} },
  );
  assert.equal(withoutProof.status(), 403);
  assert.equal(
    z.object({ code: z.string() }).parse(await withoutProof.json()).code,
    "auth.forbidden",
  );

  const accessPass = new URL(authorization);
  accessPass.searchParams.set("login_hint", config.PROFILE_PROOF_EMAIL);
  accessPass.searchParams.set(
    "one_time_token",
    config.PROFILE_PROOF_ONE_TIME_TOKEN,
  );
  const passPage = await browser.newPage();
  await passPage.goto(accessPass.href);
  await passPage.waitForURL(redirect + "?*");
  assert.ok(
    new URL(passPage.url()).searchParams.get("code"),
    "One-time access pass did not sign in",
  );

  const telegram = await browser.newPage();
  await telegram.addInitScript(() => {
    window.open = () => null;
  });
  await telegram.goto(telegramAuthorization.href);
  await telegram.waitForURL(
    (url) =>
      url.origin === new URL(redirect).origin && url.pathname === "/callback",
  );
  assert.ok(
    new URL(telegram.url()).searchParams.get("code"),
    "Telegram did not register a new account",
  );
  process.stdout.write(
    "PASS: Telegram registration, switching from Telegram to email, same provider subject, existing email and one-time access pass, unknown email rejected.\n",
  );
} finally {
  process.off("SIGTERM", interrupted);
  process.off("SIGINT", interrupted);
  await browser.close();
  server.close();
  await once(server, "close");
}
