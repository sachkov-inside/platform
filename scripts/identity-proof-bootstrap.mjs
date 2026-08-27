/* global fetch */

import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URLSearchParams } from "node:url";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(root, "infra/identity/logto/compose.yaml");
const endpoint = `https://identity.inside.localhost:${readPort("IDENTITY_PROOF_LOGTO_PORT", 3301)}`;
const adminEndpoint = `https://identity.inside.localhost:${readPort("IDENTITY_PROOF_LOGTO_ADMIN_PORT", 3302)}`;
const managementResource = "https://default.logto.app/api";
const platformResource = `http://127.0.0.1:${readPort("IDENTITY_PROOF_API_PORT", 3001)}`;
const webBaseUrl = `http://127.0.0.1:${readPort("IDENTITY_PROOF_WEB_PORT", 3000)}`;
const applicationName = "Inside Web";
const smtpConnectorId = "simple-mail-transfer-protocol";
const platformAccessTokenTtlSeconds = readAccessTokenTtl();
const mailpitPort = readPort("IDENTITY_PROOF_MAILPIT_PORT", 8026);
const platformPostgresPort = readPort("IDENTITY_PROOF_POSTGRES_PORT", 5432);
const bootstrapMaxAttempts = 20;
const bootstrapRetryDelayMilliseconds = 500;

const managementAccessTokenSchema = z.object({
  access_token: z.string().min(1),
});
const resourceSchema = z.object({
  id: z.string().min(1),
  indicator: z.string(),
});
const applicationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});
const connectorSchema = z.object({
  id: z.string().min(1),
  connectorId: z.string(),
});
const applicationSecretSchema = z.object({
  name: z.string(),
  value: z.string().min(1),
});

const smtpConfig = Object.freeze({
  host: "mailpit",
  port: 1025,
  auth: { type: "login" },
  fromEmail: "inside@identity.inside.localhost",
  secure: false,
  ignoreTLS: true,
  connectionTimeout: 2_000,
  greetingTimeout: 2_000,
  socketTimeout: 2_000,
  dnsTimeout: 2_000,
  templates: [
    template("SignIn", "Inside sign-in code"),
    template("Register", "Inside registration code"),
    template("ForgotPassword", "Inside password reset code"),
    template("Generic", "Inside verification code"),
  ],
});

async function main() {
  const bootstrapSecret = await retry(readSeededManagementSecret);
  const accessToken = await retry(() => fetchManagementAccessToken(bootstrapSecret));
  const api = createManagementApi(accessToken);

  await ensureResource(api);
  const application = await ensureApplication(api);
  await ensureEmailConnector(api);
  await ensureSignInExperience(api);
  await ensureJwtCustomizer(api);
  const applicationSecret = await readApplicationSecret(api, application.id);
  await writeRuntimeEnvironment(application.id, applicationSecret);
  if (process.argv.includes("--email-smoke")) {
    await testEmailConnector(api);
  }

  process.stdout.write(
    [
      "Identity proof configured through the Logto Management API.",
      `Application: ${applicationName} (${application.id})`,
      `Mailpit: http://127.0.0.1:${mailpitPort}`,
      `Platform: ${webBaseUrl}`,
      "",
    ].join("\n"),
  );
}

function readSeededManagementSecret() {
  const query =
    "select secret from applications where tenant_id='admin' and id='m-default'";
  const secret = execFileSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      "logto-postgres",
      "psql",
      "-U",
      "logto",
      "-d",
      "logto",
      "-Atc",
      query,
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (secret.length < 20) {
    throw new Error("Pinned Logto seed did not create the Management API bootstrap app");
  }
  return secret;
}

async function fetchManagementAccessToken(secret) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    resource: managementResource,
    scope: "all",
  });
  const response = await fetch(`${adminEndpoint}/oidc/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`m-default:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = parseManagementPayload(
    managementAccessTokenSchema,
    await readResponse(response, "Management API token request"),
    "Management API token response",
  );
  return payload.access_token;
}

function createManagementApi(accessToken) {
  return async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${endpoint}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return readResponse(response, `${method} ${path}`);
  };
}

export async function ensureResource(api) {
  const resources = parseManagementPayload(
    z.array(resourceSchema),
    await api("/resources"),
    "Logto resources response",
  );
  const resource = findSingle(resources, ({ indicator }) => indicator === platformResource);
  const body = {
    name: "Inside Platform API",
    indicator: platformResource,
    accessTokenTtl: platformAccessTokenTtlSeconds,
  };
  if (resource === undefined) {
    await api("/resources", { method: "POST", body });
    return;
  }
  await api(`/resources/${resource.id}`, {
    method: "PATCH",
    body: { name: body.name, accessTokenTtl: body.accessTokenTtl },
  });
}

export async function ensureApplication(api) {
  const applications = parseManagementPayload(
    z.array(applicationSchema),
    await api("/applications"),
    "Logto applications response",
  );
  const current = findSingle(applications, ({ name }) => name === applicationName);
  const oidcClientMetadata = {
    redirectUris: [`${webBaseUrl}/callback`],
    postLogoutRedirectUris: [`${webBaseUrl}/`],
  };
  if (current === undefined) {
    return parseManagementPayload(
      applicationSchema,
      await api("/applications", {
        method: "POST",
        body: { name: applicationName, type: "Traditional", oidcClientMetadata },
      }),
      "Logto application creation response",
    );
  }
  return parseManagementPayload(
    applicationSchema,
    await api(`/applications/${current.id}`, {
      method: "PATCH",
      body: { name: applicationName, oidcClientMetadata },
    }),
    "Logto application update response",
  );
}

export async function ensureEmailConnector(api) {
  const connectors = parseManagementPayload(
    z.array(connectorSchema),
    await api("/connectors"),
    "Logto connectors response",
  );
  const connector = findSingle(
    connectors,
    ({ connectorId }) => connectorId === smtpConnectorId,
  );
  if (connector === undefined) {
    await api("/connectors", {
      method: "POST",
      body: { connectorId: smtpConnectorId, config: smtpConfig },
    });
    return;
  }
  await api(`/connectors/${connector.id}`, {
    method: "PATCH",
    body: { config: smtpConfig },
  });
}

export async function ensureSignInExperience(api) {
  await api("/sign-in-exp", {
    method: "PATCH",
    body: {
      color: {
        primaryColor: "#EE5D27",
        isDarkModeEnabled: false,
        darkPrimaryColor: "#EE5D27",
      },
      branding: {},
      languageInfo: { autoDetect: false, fallbackLanguage: "ru" },
      signIn: {
        methods: [
          {
            identifier: "email",
            password: false,
            verificationCode: true,
            isPasswordPrimary: false,
          },
        ],
      },
      signUp: { identifiers: ["email"], password: false, verify: true },
      signInMode: "SignInAndRegister",
    },
  });
}

async function ensureJwtCustomizer(api) {
  const script = await readFile(
    resolve(root, "infra/identity/logto/custom-access-token.js"),
    "utf8",
  );
  await api("/configs/jwt-customizer/access-token", {
    method: "PUT",
    body: { script, blockIssuanceOnError: true },
  });
}

async function readApplicationSecret(api, applicationId) {
  const secrets = parseManagementPayload(
    z.array(applicationSecretSchema),
    await api(`/applications/${applicationId}/secrets`),
    "Logto application secrets response",
  );
  const secret = findSingle(secrets, ({ name }) => name === "Default secret");
  if (secret === undefined) {
    throw new Error("Inside Web application has no default secret");
  }
  return secret.value;
}

async function testEmailConnector(api) {
  await api(`/connectors/${smtpConnectorId}/test`, {
    method: "POST",
    body: { email: "identity-proof@example.test", locale: "en", config: smtpConfig },
  });
}

async function writeRuntimeEnvironment(applicationId, applicationSecret) {
  const envPath = resolve(root, ".identity-proof/platform.env");
  const current = await readFile(envPath, "utf8").catch(() => "");
  const existing = parseEnv(current);
  const updates = {
    NODE_ENV: "development",
    DATABASE_URL: `postgresql://inside:inside@127.0.0.1:${platformPostgresPort}/inside`,
    BACKEND_BASE_URL: platformResource,
    LOGTO_ENDPOINT: endpoint,
    LOGTO_ISSUER: `${endpoint}/oidc`,
    LOGTO_AUDIENCE: platformResource,
    LOGTO_JWKS_URL: `${endpoint}/oidc/jwks`,
    LOGTO_APP_ID: applicationId,
    LOGTO_APP_SECRET: applicationSecret,
    LOGTO_COOKIE_SECRET: existing.LOGTO_COOKIE_SECRET ?? randomSecret(),
    IDENTITY_EMAIL_FINGERPRINT_KEY:
      existing.IDENTITY_EMAIL_FINGERPRINT_KEY ?? randomSecret(),
    WEB_BASE_URL: webBaseUrl,
  };
  await mkdir(dirname(envPath), { recursive: true });
  const temporaryPath = `${envPath}.${String(process.pid)}.tmp`;
  try {
    await writeFile(temporaryPath, mergeEnv(current, updates), { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, envPath);
    await chmod(envPath, 0o600);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export function mergeEnv(source, updates) {
  const pending = new Map(Object.entries(updates));
  const lines = source.length === 0 ? [] : source.replace(/\n$/u, "").split(/\r?\n/u);
  const merged = lines.map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/u.exec(line);
    const key = match?.[1];
    if (key === undefined || !pending.has(key)) {
      return line;
    }
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of pending) {
    merged.push(`${key}=${value}`);
  }
  return `${merged.join("\n")}\n`;
}

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
}

function findSingle(values, predicate) {
  const matches = values.filter(predicate);
  if (matches.length > 1) {
    throw new Error("Disposable Logto contains duplicate proof resources");
  }
  return matches[0];
}

function parseManagementPayload(schema, payload, operation) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(`${operation} is invalid`, { cause: result.error });
  }
  return result.data;
}

async function readResponse(response, operation) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}: ${text}`);
  }
  return text.length === 0 ? undefined : JSON.parse(text);
}

function template(usageType, subject) {
  return {
    usageType,
    contentType: "text/plain",
    subject,
    content: `${subject}: {{code}}`,
  };
}

function randomSecret() {
  return randomBytes(32).toString("hex");
}

async function retry(operation) {
  let lastError;
  for (let attempt = 1; attempt <= bootstrapMaxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await delay(bootstrapRetryDelayMilliseconds);
    }
  }
  throw new Error("Logto did not become ready for bootstrap", { cause: lastError });
}

function minutesInSeconds(minutes) {
  return minutes * 60;
}

function readPort(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
}

function readAccessTokenTtl() {
  const value = process.env.IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS;
  if (value === undefined) return minutesInSeconds(5);
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > minutesInSeconds(5)) {
    throw new Error("IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS must be between 60 and 300");
  }
  return seconds;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
