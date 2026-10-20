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
try {
  const previous = new Set((await messages()).map((message) => message.ID));
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
  const page = await browser.newPage();
  await page.goto(authorization.href);
  await page.locator('input[type="email"]').fill(config.PROFILE_PROOF_EMAIL);
  await page.locator('button[type="submit"]').click();
  const inputs = page.locator(
    'input[inputmode="numeric"], input[autocomplete="one-time-code"]',
  );
  await inputs.first().waitFor();
  const readCode = async () => {
    const delivered = (await messages()).find(
      (message) =>
        !previous.has(message.ID) &&
        message.To.some(
          (recipient) => recipient.Address === config.PROFILE_PROOF_EMAIL,
        ),
    );
    return /\b([0-9]{6})\b/u.exec(delivered?.Snippet ?? "")?.[1];
  };
  await expect.poll(readCode).toMatch(/^[0-9]{6}$/u);
  const code = await readCode();
  assert.ok(code, "New sign-in email was not delivered");
  if ((await inputs.count()) === 1) await inputs.fill(code);
  else
    for (let index = 0; index < code.length; index++)
      await inputs.nth(index).fill(code.charAt(index));
  const submit = page.locator('button[type="submit"]');
  if (await submit.isVisible()) await submit.click();
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
  assert.equal(user.sub, config.PROFILE_PROOF_SUBJECT);
  assert.equal(user.email, config.PROFILE_PROOF_EMAIL);
  process.stdout.write(
    "PASS: fresh email-code sign-in preserves the original provider subject.\n",
  );
} finally {
  process.off("SIGTERM", interrupted);
  process.off("SIGINT", interrupted);
  await browser.close();
  server.close();
  await once(server, "close");
}
