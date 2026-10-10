import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { buffer } from "node:stream/consumers";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { z } from "zod";
import { productCapability } from "@inside/access-capabilities";
import { parsePlatformConfig } from "../src/config/platform-config.js";
import { startLocalBankDouble } from "../src/development/bank-double/start-local-bank-double.js";
import { seedLocalDevelopment } from "../src/development/seed-local-development.js";
import { createApiApplication } from "../src/entrypoints/api/create-api-application.js";
import { createPrismaClient } from "../src/infrastructure/prisma/index.js";
import { migrateToLatest } from "../src/migrations/index.js";
import { bootstrapOwnerAccount } from "../src/modules/accounts/index.js";
import {
  BillingPayments,
  BillingPricing,
} from "../src/modules/billing/index.js";

/**
 * Стенд сквозного пути покупателя: настоящие API, PostgreSQL, миграции и сид продукта, двойник
 * банка стенда, перехват писем и тестовый провайдер входа через Telegram. Провайдер отвечает по
 * протоколу OIDC тем же, что Logto после подтверждения в боте: код авторизации, токен доступа с
 * доказательством входа через Telegram и refresh-токен. Бот подтверждает связку по контракту
 * `inside.bot-sign-in.v1`. Ни один внешний сервис не вызывается, ни один секрет не настоящий.
 */
const environment = z
  .object({
    BUYER_JOURNEY_FIXTURE_PATH: z.string().min(1),
    BUYER_JOURNEY_API_PORT: z.coerce.number().int().positive(),
    BUYER_JOURNEY_BANK_PORT: z.coerce.number().int().positive(),
    BUYER_JOURNEY_WEB_BASE_URL: z.url(),
  })
  .parse(process.env);
const appId = "inside-web-buyer-journey";
const telegramSecret = "synthetic-buyer-journey-telegram-sign-in-775";
const apiBaseUrl = `http://127.0.0.1:${String(environment.BUYER_JOURNEY_API_PORT)}`;
const bankOrigin = `http://127.0.0.1:${String(environment.BUYER_JOURNEY_BANK_PORT)}`;
const productId = "72000000-0000-4000-8000-000000000007";
const courseOfferId = "72000000-0000-4000-8000-000000000503";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      resolve();
    }),
  );
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Fixture server has no port");
  return `http://127.0.0.1:${String(address.port)}`;
}
async function body(request: IncomingMessage): Promise<string> {
  return (await buffer(request)).toString("utf8");
}

// ------------------------------------------------------------------------- перехват писем
/** Коды подтверждения email по получателю: письмо никуда не уходит. */
const contactCodes = new Map<string, string>();
const smtp = createTcpServer((socket) => {
  socket.write("220 buyer-journey synthetic SMTP\r\n");
  let buffer = "";
  let data = false;
  let recipient = "";
  let message: string[] = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\r\n")) {
      const end = buffer.indexOf("\r\n");
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (data) {
        if (line !== ".") {
          message.push(line);
          continue;
        }
        // Nodemailer кодирует русское письмо в base64: код ищется в раскодированном тексте.
        const raw = message.join("\n");
        const split = raw.indexOf("\n\n");
        const text = /Content-Transfer-Encoding: base64/iu.test(raw)
          ? Buffer.from(
              raw.slice(split + 2).replaceAll("\n", ""),
              "base64",
            ).toString("utf8")
          : raw.slice(split + 2);
        const code = /: ([0-9]{6})\./u.exec(text)?.[1];
        if (code !== undefined) contactCodes.set(recipient, code);
        message = [];
        data = false;
        socket.write("250 queued\r\n");
        continue;
      }
      const command = line.toUpperCase();
      if (command.startsWith("EHLO") || command.startsWith("HELO"))
        socket.write("250 buyer-journey\r\n");
      else if (command.startsWith("RCPT TO:")) {
        recipient = /<([^>]+)>/u.exec(line)?.[1] ?? "";
        socket.write("250 ok\r\n");
      } else if (command === "DATA") {
        data = true;
        socket.write("354 end with .\r\n");
      } else if (command === "QUIT") {
        socket.end("221 bye\r\n");
      } else socket.write("250 ok\r\n");
    }
  });
});
await new Promise<void>((resolve) =>
  smtp.listen(0, "127.0.0.1", () => {
    resolve();
  }),
);
const smtpAddress = smtp.address();
if (smtpAddress === null || typeof smtpAddress === "string")
  throw new Error("SMTP capture has no port");

// ------------------------------------------ тестовый провайдер входа и бот Inside
const keyPair = await generateKeyPair("ES384");
const publicJwk = {
  ...(await exportJWK(keyPair.publicKey)),
  alg: "ES384",
  kid: "buyer-journey-key",
};
interface Session {
  readonly subject: string;
  readonly telegram: {
    readonly subjectRef: string;
    readonly requestRef: string;
  };
}
const codes = new Map<string, Session & { readonly redirectUri: string }>();
const refreshTokens = new Map<string, Session>();
let origin = "";
// Издатель — строка из токенов, а не адрес: API принимает только HTTPS-издателя, а документ
// обнаружения и ключи отдаёт петля. Так же устроена идентичность полного стенда.
const issuer = () => "https://identity.buyer-journey.test/oidc";
function sign(
  claims: Record<string, unknown>,
  audience: string,
  subject: string,
) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES384", kid: "buyer-journey-key" })
    .setIssuer(issuer())
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(keyPair.privateKey);
}
/** Токены одного входа: доступ к API несёт доказательство входа через Telegram, как у Logto. */
async function tokens(session: Session, refreshToken: string) {
  return {
    access_token: await sign(
      { inside_telegram_sign_in: session.telegram },
      apiBaseUrl,
      session.subject,
    ),
    id_token: await sign({}, appId, session.subject),
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 300,
    scope: "openid offline_access",
  };
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (character) => `&#${String(character.charCodeAt(0))};`,
  );
/** Один и тот же человек Telegram всегда приходит с одной и той же ссылкой на субъекта. */
const subjectRefOf = (telegramUserId: string) => {
  const hex = createHash("sha256")
    .update(`buyer-journey:${telegramUserId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const identity = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", origin);
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (url.pathname === "/oidc/.well-known/openid-configuration")
      return json(200, {
        issuer: issuer(),
        authorization_endpoint: `${origin}/oidc/auth`,
        token_endpoint: `${origin}/oidc/token`,
        userinfo_endpoint: `${origin}/oidc/me`,
        end_session_endpoint: `${origin}/oidc/session/end`,
        revocation_endpoint: `${origin}/oidc/token/revocation`,
        jwks_uri: `${origin}/oidc/jwks`,
      });
    if (url.pathname === "/oidc/jwks") return json(200, { keys: [publicJwk] });
    if (url.pathname === "/oidc/auth" && request.method === "GET") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход в Inside</title></head>
<body><h1>Тестовый провайдер входа</h1>
<form method="post" action="/oidc/auth/telegram">
<input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<label>Telegram ID <input name="telegram_user_id" inputmode="numeric" required></label>
<button type="submit">Войти через Telegram</button>
</form></body></html>`);
    }
    if (url.pathname === "/oidc/auth/telegram" && request.method === "POST") {
      const form = new URLSearchParams(await body(request));
      const telegramUserId = z
        .string()
        .regex(/^[1-9][0-9]{0,15}$/u)
        .parse(form.get("telegram_user_id"));
      const redirectUri = z.url().parse(form.get("redirect_uri"));
      const code = randomUUID();
      codes.set(code, {
        redirectUri,
        subject: `telegram-${telegramUserId}`,
        telegram: {
          subjectRef: subjectRefOf(telegramUserId),
          requestRef: randomUUID(),
        },
      });
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      target.searchParams.set("state", form.get("state") ?? "");
      response.writeHead(303, { location: target.toString() });
      return response.end();
    }
    if (url.pathname === "/oidc/token" && request.method === "POST") {
      const form = new URLSearchParams(await body(request));
      if (form.get("grant_type") === "authorization_code") {
        const grant = codes.get(form.get("code") ?? "");
        if (
          grant === undefined ||
          grant.redirectUri !== form.get("redirect_uri")
        )
          return json(400, { error: "invalid_grant" });
        codes.delete(form.get("code") ?? "");
        const refreshToken = `buyer-journey-refresh-${randomUUID()}`;
        refreshTokens.set(refreshToken, grant);
        return json(200, await tokens(grant, refreshToken));
      }
      if (form.get("grant_type") === "refresh_token") {
        const refreshToken = form.get("refresh_token") ?? "";
        const session = refreshTokens.get(refreshToken);
        if (session === undefined) return json(400, { error: "invalid_grant" });
        return json(200, await tokens(session, refreshToken));
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/oidc/token/revocation") return json(200, {});
    if (url.pathname === "/oidc/session/end") {
      response.writeHead(303, {
        location:
          url.searchParams.get("post_logout_redirect_uri") ??
          environment.BUYER_JOURNEY_WEB_BASE_URL,
      });
      return response.end();
    }
    // Бот Inside: личность подтверждена, связка с Account принята.
    const link =
      /^\/integrations\/identity\/v1\/sign-in\/([0-9a-f-]{36})\/account-link$/u.exec(
        url.pathname,
      );
    if (link !== null && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${telegramSecret}`)
        return json(401, { error: "unauthorized" });
      const command = z
        .object({ subjectRef: z.uuid() })
        .loose()
        .parse(JSON.parse(await body(request)));
      return json(200, {
        contractVersion: "inside.bot-sign-in.v1",
        status: "linked",
        telegramIdentityRef: command.subjectRef,
      });
    }
    // Код подтверждения email для проверки: только этому стенду и только по получателю.
    if (url.pathname === "/control/contact-code") {
      const code = contactCodes.get(url.searchParams.get("email") ?? "");
      return code === undefined ? json(404, {}) : json(200, { code });
    }
    return json(404, { error: "not_found" });
  })().catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});
origin = await listen(identity);

// ------------------------------------------------------------------ база, API и банк
const container = await new PostgreSqlContainer(
  "public.ecr.aws/docker/library/postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15",
).start();
const databaseUrl = container.getConnectionUri();
const prisma = createPrismaClient(databaseUrl);
await migrateToLatest(databaseUrl);
const stand = {
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  LOGTO_ISSUER: issuer(),
  LOGTO_AUDIENCE: apiBaseUrl,
  LOGTO_JWKS_URL: `${origin}/oidc/jwks`,
  IDENTITY_EMAIL_FINGERPRINT_KEY: "buyer-journey-email-fingerprint-key-775",
  TELEGRAM_SIGN_IN_ENABLED: "true",
  TELEGRAM_SIGN_IN_PROVIDER_URL: origin,
  TELEGRAM_SIGN_IN_INTEGRATION_SECRET: telegramSecret,
  TBANK_PROVIDER_MODE: "test",
  TBANK_TEST_API_BASE_URL: `${bankOrigin}/v2`,
  TBANK_TEST_PUBLIC_ORIGIN: bankOrigin,
  TBANK_TEST_NOTIFICATION_URL: `${apiBaseUrl}/billing/tbank/notification`,
  TBANK_TEST_RETURN_URL: `${environment.BUYER_JOURNEY_WEB_BASE_URL}/payment/return`,
  BILLING_CONTACT_ENCRYPTION_KEY: Buffer.alloc(32, 77).toString("base64"),
  BILLING_CONTACT_SMTP_HOST: "127.0.0.1",
  BILLING_CONTACT_SMTP_PORT: String(smtpAddress.port),
  BILLING_CONTACT_FROM: "inside@buyer-journey.test",
};
const config = parsePlatformConfig(stand);
if (config.tbank === undefined)
  throw new Error("Bank double is not configured");
const bank = await startLocalBankDouble({
  config: config.tbank,
  host: "127.0.0.1",
  port: environment.BUYER_JOURNEY_BANK_PORT,
  ledgerPath: join(tmpdir(), `inside-buyer-journey-bank-${randomUUID()}.json`),
});
const app = await createApiApplication(config, { logger: false });
await app.listen(environment.BUYER_JOURNEY_API_PORT, "127.0.0.1");

// Продукт «Создание Platform Inside» с бесплатной и закрытой главой из сида стенда.
await seedLocalDevelopment(prisma, { demo: "published" });
const owner = await bootstrapOwnerAccount(
  prisma,
  { issuer: issuer(), subject: "buyer-journey-owner" },
  "platform:admin",
);
// Предложение продукта получает сроки предложения курса: материалы и общий чат без срока,
// сопровождение — шесть месяцев с оплаты.
const pricing = app.get(BillingPricing);
const current = await prisma.billingOffer.findUniqueOrThrow({
  where: { id: courseOfferId },
});
const capability = productCapability(productId);
const saved = await pricing.manage(owner.accountId, {
  operation: "offers.save",
  operationId: randomUUID(),
  expectedRevision: current.revision,
  value: {
    id: courseOfferId,
    name: current.name,
    benefits: [capability, "community", "support"],
    benefitPeriods: [
      { capability, months: null },
      { capability: "community", months: null },
      { capability: "support", months: 6 },
    ],
  },
});
if (!saved.ok) throw new Error(`Course offer terms: ${saved.error.code}`);

// Роль billing-worker: подтверждённая оплата превращается в права без ожидания очереди.
const payments = app.get(BillingPayments);
const recovery = setInterval(() => {
  void payments.recover(20);
}, 500);

await writeFile(
  environment.BUYER_JOURNEY_FIXTURE_PATH,
  JSON.stringify({
    BACKEND_BASE_URL: apiBaseUrl,
    LOGTO_ENDPOINT: origin,
    LOGTO_AUDIENCE: apiBaseUrl,
    LOGTO_APP_ID: appId,
    CONTROL_URL: origin,
    PRODUCT_SLUG: "platform-inside",
  }),
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(recovery);
  await app.close();
  await bank.close();
  await new Promise((resolve) => identity.close(resolve));
  await new Promise((resolve) => smtp.close(resolve));
  await prisma.$disconnect();
  await container.stop();
}
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void stop().then(() => process.exit(0));
  });
