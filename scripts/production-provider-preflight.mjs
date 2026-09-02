import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const secretPolicy = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "infra/production/secrets/secret-policy.json"),
    "utf8",
  ),
);
const exactUrl = (expected) =>
  z.url().refine((value) => value === expected, {
    message: `must equal ${expected}`,
  });
const secretReference = (name) => z.literal(`secret://${name}`);
const bucket = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u);
const configuredIdentifier = z.string().trim().min(1).max(128).refine(
  (value) => !/replace|placeholder|example/iu.test(value),
  { message: "must be a configured provider identifier" },
);
const configuredHost = z.string().trim().min(1).refine(
  (value) => !/replace|placeholder|example/iu.test(value),
  { message: "must be a configured provider host" },
);
const enabledState = z.object({ state: z.literal("enabled") }).strict();
const disabledState = z.object({ state: z.literal("disabled") }).strict();

const emailSchema = z.discriminatedUnion("state", [
  enabledState.extend({
    fromAddress: z.email(),
    smtpHost: configuredHost,
    smtpPasswordRef: secretReference("smtpPassword"),
    smtpPort: z.number().int().min(1).max(65_535),
    smtpUsernameRef: secretReference("smtpUsername"),
  }).strict(),
  disabledState,
]);
const assetsSchema = z.discriminatedUnion("state", [
  enabledState.extend({
    accessKeyIdRef: secretReference("assetStorageAccessKeyId"),
    endpoint: exactUrl("https://storage.yandexcloud.net"),
    protectedBucket: bucket,
    publicBucket: bucket,
    quarantineBucket: bucket,
    region: z.literal("ru-central1"),
    secretAccessKeyRef: secretReference("assetStorageSecretAccessKey"),
  }).strict(),
  disabledState,
]);
const kinescopeSchema = z.discriminatedUnion("state", [
  enabledState.extend({
    apiBaseUrl: exactUrl("https://api.kinescope.io"),
    apiTokenRef: secretReference("kinescopeApiToken"),
    callbackPasswordRef: secretReference("kinescopeCallbackPassword"),
    membershipProjectId: configuredIdentifier,
    playbackJwtSecretRef: secretReference("kinescopePlaybackJwtSecret"),
    publicProjectId: configuredIdentifier,
    uploaderBaseUrl: exactUrl("https://uploader.kinescope.io"),
    webhookPasswordRef: secretReference("kinescopeWebhookPassword"),
  }).strict(),
  disabledState,
]);
const telegramSchema = z.discriminatedUnion("state", [
  enabledState.extend({
    botStartUrl: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname === "t.me" &&
        !/replace|placeholder|example/iu.test(url.pathname)
      );
    }, { message: "must use an HTTPS t.me URL" }),
    evidenceIngressSecretRef: secretReference("telegramEvidenceIngressSecret"),
    linkingEndpoint: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !/replace|placeholder|example/iu.test(url.hostname) &&
        url.pathname.endsWith("/integrations/platform/v1/identity-links") &&
        url.username.length === 0 &&
        url.password.length === 0 &&
        url.search.length === 0 &&
        url.hash.length === 0
      );
    }, { message: "must use HTTPS and the exact Platform identity-links path" }),
    linkingSecretRef: secretReference("telegramLinkingSecret"),
  }).strict(),
  disabledState,
]);
const mcpSchema = z.discriminatedUnion("state", [
  enabledState.extend({
    serverUrl: exactUrl("https://inside.sachkov.dev/mcp"),
  }).strict(),
  disabledState,
]);
const contractSchema = z.object({
  schemaVersion: z.literal(1),
  profile: z.enum(["degraded", "release"]),
  platformOrigin: exactUrl("https://inside.sachkov.dev"),
  identity: z.object({
    authOrigin: exactUrl("https://auth.sachkov.dev"),
    audience: exactUrl("https://api.inside.sachkov.dev"),
    callbackUrl: exactUrl("https://inside.sachkov.dev/callback"),
    issuer: exactUrl("https://auth.sachkov.dev/oidc"),
    jwksUrl: exactUrl("https://auth.sachkov.dev/oidc/jwks"),
    logtoApplicationSecretRef: secretReference("logtoApplicationSecret"),
    logtoCookieSecretRef: secretReference("logtoCookieSecret"),
    secretVaultKekRef: secretReference("logtoSecretVaultKek"),
  }).strict(),
  email: emailSchema,
  assets: assetsSchema,
  backups: z.object({
    accessKeyIdRef: secretReference("backupStorageAccessKeyId"),
    bucket,
    cipherPassphraseRef: secretReference("backupRepositoryCipherPassphrase"),
    endpoint: exactUrl("https://storage.yandexcloud.net"),
    region: z.literal("ru-central1"),
    secretAccessKeyRef: secretReference("backupStorageSecretAccessKey"),
  }).strict(),
  kinescope: kinescopeSchema,
  telegram: telegramSchema,
  mcp: mcpSchema,
}).strict();

export function parseProviderContract(input) {
  const parsed = contractSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${issue.path.join(".") || "contract"}: ${issue.message}`);
  }
  const contract = parsed.data;
  if (contract.profile === "release") {
    for (const provider of ["assets", "email", "kinescope", "mcp", "telegram"]) {
      if (contract[provider].state !== "enabled") {
        throw new Error(`${provider}.state: must be enabled for release profile`);
      }
    }
  }
  if (contract.assets.state === "enabled") {
    const assetBuckets = [
      contract.assets.protectedBucket,
      contract.assets.publicBucket,
      contract.assets.quarantineBucket,
    ];
    if (new Set(assetBuckets).size !== assetBuckets.length) {
      throw new Error("assets.buckets: asset buckets must be distinct");
    }
    if (assetBuckets.includes(contract.backups.bucket)) {
      throw new Error("backups.bucket: backup bucket must be separate from asset buckets");
    }
    if (contract.assets.accessKeyIdRef === contract.backups.accessKeyIdRef) {
      throw new Error("backups.accessKeyIdRef: backup identity must be separate from asset identity");
    }
  }
  if (
    contract.kinescope.state === "enabled" &&
    contract.kinescope.publicProjectId === contract.kinescope.membershipProjectId
  ) {
    throw new Error("kinescope.membershipProjectId: projects must be distinct");
  }
  validateReferences(contract);
  return contract;
}

function validateReferences(contract) {
  const known = new Set();
  for (const service of Object.values(secretPolicy.services)) {
    for (const name of Object.values(service.secrets)) known.add(name);
  }
  const references = collectSecretReferences(contract);
  for (const reference of references) {
    const name = reference.slice("secret://".length);
    if (!known.has(name)) {
      throw new Error(`secretRef.${name}: reference is not declared by secret policy`);
    }
  }
}

function collectSecretReferences(value) {
  if (typeof value === "string") {
    return value.startsWith("secret://") ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(collectSecretReferences);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(collectSecretReferences);
  }
  return [];
}

function parseEnvironmentFile(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`${path}: invalid materialized environment file`);
    const name = line.slice(0, separator);
    try {
      values[name] = JSON.parse(line.slice(separator + 1));
    } catch {
      throw new Error(`${path}: invalid materialized environment encoding`);
    }
  }
  return values;
}

export function validateMaterializedProviderIdentities(runtimeSecretRoot) {
  const api = parseEnvironmentFile(resolve(runtimeSecretRoot, "current/api.env"));
  const backup = parseEnvironmentFile(
    resolve(runtimeSecretRoot, "current/pgbackrest.env"),
  );
  if (
    typeof api.OBJECT_STORAGE_ACCESS_KEY_ID !== "string" ||
    typeof backup.PGBACKREST_REPO1_S3_KEY !== "string"
  ) {
    throw new Error("materializedIdentities: required access key IDs are missing");
  }
  if (api.OBJECT_STORAGE_ACCESS_KEY_ID === backup.PGBACKREST_REPO1_S3_KEY) {
    throw new Error("materializedIdentities: backup and asset identities must be distinct");
  }
}

function processSummary(contract) {
  return {
    api: ["identity", contract.assets.state, contract.kinescope.state, contract.telegram.state],
    logto: ["identity", contract.email.state],
    mcp: ["identity", contract.mcp.state],
    pgbackrest: ["backups"],
    web: ["identity"],
  };
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Every option must use --name value");
    }
    options[name.slice(2)] = value;
  }
  if (options.config === undefined) throw new Error("Missing option: config");
  return options;
}

function run() {
  const options = parseArguments(process.argv.slice(2));
  const contract = parseProviderContract(
    JSON.parse(readFileSync(resolve(options.config), "utf8")),
  );
  if (options["runtime-secret-root"] !== undefined) {
    validateMaterializedProviderIdentities(resolve(options["runtime-secret-root"]));
  }
  console.log(JSON.stringify({
    profile: contract.profile,
    processes: processSummary(contract),
    status: "ready",
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Provider preflight failed");
    process.exitCode = 1;
  }
}
