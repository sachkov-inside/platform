/* global fetch */

import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URLSearchParams } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(root, "infra/identity/logto/compose.yaml");
const endpoint = "https://identity.inside.localhost:3301";
const adminEndpoint = "https://identity.inside.localhost:3302";
const managementResource = "https://default.logto.app/api";
const platformResource = "http://127.0.0.1:3001";
const webBaseUrl = "http://127.0.0.1:3000";
const applicationName = "Inside Web";
const smtpConnectorId = "simple-mail-transfer-protocol";

const smtpConfig = Object.freeze({
  host: "mailpit",
  port: 1025,
  auth: { type: "login" },
  fromEmail: "inside@identity.inside.localhost",
  secure: false,
  ignoreTLS: true,
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
      "Mailpit: http://127.0.0.1:8026",
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
  const payload = await readResponse(response, "Management API token request");
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("access_token" in payload) ||
    typeof payload.access_token !== "string"
  ) {
    throw new Error("Management API token response has no access token");
  }
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
  const resources = await api("/resources");
  const resource = findSingle(resources, ({ indicator }) => indicator === platformResource);
  const body = {
    name: "Inside Platform API",
    indicator: platformResource,
    accessTokenTtl: 300,
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
  const applications = await api("/applications");
  const current = findSingle(applications, ({ name }) => name === applicationName);
  const oidcClientMetadata = {
    redirectUris: [
      `${webBaseUrl}/callback`,
      `${webBaseUrl}/reauthentication-callback`,
    ],
    postLogoutRedirectUris: [`${webBaseUrl}/`],
  };
  if (current === undefined) {
    return api("/applications", {
      method: "POST",
      body: { name: applicationName, type: "Traditional", oidcClientMetadata },
    });
  }
  return api(`/applications/${current.id}`, {
    method: "PATCH",
    body: { name: applicationName, oidcClientMetadata },
  });
}

export async function ensureEmailConnector(api) {
  const connectors = await api("/connectors");
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
  const secrets = await api(`/applications/${applicationId}/secrets`);
  const secret = findSingle(secrets, ({ name }) => name === "Default secret");
  if (secret === undefined || typeof secret.value !== "string") {
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
    DATABASE_URL: "postgresql://inside:inside@127.0.0.1:5432/inside",
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
  if (!Array.isArray(values)) {
    throw new TypeError("Logto Management API returned a non-array collection");
  }
  const matches = values.filter(predicate);
  if (matches.length > 1) {
    throw new Error("Disposable Logto contains duplicate proof resources");
  }
  return matches[0];
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
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw new Error("Logto did not become ready for bootstrap", { cause: lastError });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
