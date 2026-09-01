const DEFAULT_DATABASE_URL =
  "postgresql://inside:inside@127.0.0.1:5432/inside";
const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = "3001";
const DEFAULT_LOGTO_ISSUER = "https://identity.inside.localhost:3301/oidc";
const DEFAULT_LOGTO_AUDIENCE = "http://127.0.0.1:3001";
const DEFAULT_LOGTO_JWKS_URL = "https://identity.inside.localhost:3301/oidc/jwks";
const DEFAULT_EMAIL_FINGERPRINT_KEY = "inside-local-email-fingerprint-key";
const DEFAULT_MEMBERSHIP_ACQUISITION_URL = "https://t.me/tribute";
const DEFAULT_TELEGRAM_BOT_START_URL = "https://t.me/inside_local_bot";
const DEFAULT_TELEGRAM_LINKING_ENDPOINT =
  "http://127.0.0.1:3002/integrations/platform/v1/identity-links";
const DEFAULT_TELEGRAM_LINKING_SECRET = "inside-local-telegram-link-secret";
const DEFAULT_TELEGRAM_EVIDENCE_INGRESS_SECRET =
  "inside-local-telegram-evidence-secret";
const DEFAULT_TELEGRAM_LINK_LIFETIME_SECONDS = "300";
const DEFAULT_OBJECT_STORAGE_ENDPOINT = "http://127.0.0.1:9000";
const DEFAULT_OBJECT_STORAGE_REGION = "ru-central1";
const DEFAULT_OBJECT_STORAGE_ACCESS_KEY_ID = "inside-local-access-key";
const DEFAULT_OBJECT_STORAGE_SECRET_ACCESS_KEY = "inside-local-secret-key";
const DEFAULT_OBJECT_STORAGE_PUBLIC_BUCKET = "inside-local-public";
const DEFAULT_OBJECT_STORAGE_PROTECTED_BUCKET = "inside-local-protected";
const DEFAULT_OBJECT_STORAGE_QUARANTINE_BUCKET = "inside-local-quarantine";
const DEFAULT_OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS = "60";
const DEFAULT_MATERIAL_ASSET_ORPHAN_GRACE_SECONDS = "86400";

export const PLATFORM_CONFIG = Symbol("PLATFORM_CONFIG");

export type PlatformMode = "development" | "test" | "production";

export interface PlatformConfig {
  readonly mode: PlatformMode;
  readonly database: Readonly<{
    url: string;
  }>;
  readonly api: Readonly<{
    host: string;
    port: number;
  }>;
  readonly identity: Readonly<{
    issuer: string;
    audience: string;
    jwksUrl: string;
    emailFingerprintKey: string;
  }>;
  readonly contentAccess: Readonly<{
    membershipAcquisitionUrl: string;
  }>;
  readonly objectStorage: Readonly<{
    accessKeyId: string;
    buckets: Readonly<{
      protected: string;
      public: string;
      quarantine: string;
    }>;
    endpoint: string;
    forcePathStyle: boolean;
    orphanGraceMs: number;
    region: string;
    secretAccessKey: string;
    signedGetTtlSeconds: number;
  }>;
  readonly telegramMembership: Readonly<{
    botStartUrl: string;
    evidenceIngressSecret: string;
    linkingEndpoint: string;
    linkingSecret: string;
    linkLifetimeMs: number;
  }>;
}

export type PlatformDatabaseConfig = PlatformConfig["database"];

function parseMode(value: string | undefined): PlatformMode {
  const mode = value ?? "production";
  if (mode === "development" || mode === "test" || mode === "production") {
    return mode;
  }

  throw new Error("NODE_ENV must be development, test, or production");
}

function readRuntimeValue(
  environment: NodeJS.ProcessEnv,
  name:
    | "API_HOST"
    | "API_PORT"
    | "DATABASE_URL"
    | "IDENTITY_EMAIL_FINGERPRINT_KEY"
    | "LOGTO_AUDIENCE"
    | "LOGTO_ISSUER"
    | "LOGTO_JWKS_URL"
    | "MEMBERSHIP_ACQUISITION_URL"
    | "MATERIAL_ASSET_ORPHAN_GRACE_SECONDS"
    | "OBJECT_STORAGE_ACCESS_KEY_ID"
    | "OBJECT_STORAGE_ENDPOINT"
    | "OBJECT_STORAGE_PROTECTED_BUCKET"
    | "OBJECT_STORAGE_PUBLIC_BUCKET"
    | "OBJECT_STORAGE_QUARANTINE_BUCKET"
    | "OBJECT_STORAGE_REGION"
    | "OBJECT_STORAGE_SECRET_ACCESS_KEY"
    | "OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS"
    | "TELEGRAM_BOT_START_URL"
    | "TELEGRAM_EVIDENCE_INGRESS_SECRET"
    | "TELEGRAM_LINKING_ENDPOINT"
    | "TELEGRAM_LINKING_SECRET"
    | "TELEGRAM_LINK_LIFETIME_SECONDS",
  mode: PlatformMode,
  localDefault: string,
): string {
  const value = environment[name]?.trim();
  if (value !== undefined && value.length > 0) {
    return value;
  }
  if (mode !== "production") {
    return localDefault;
  }

  throw new Error(`${name} is required in production mode`);
}

function validateDatabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      "DATABASE_URL must use the postgres or postgresql protocol",
    );
  }

  return value;
}

function parseApiPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  return port;
}

function parseBoundedSeconds(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < minimum || seconds > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return seconds;
}

function parseObjectStorageConfig(
  environment: NodeJS.ProcessEnv,
  mode: PlatformMode,
): PlatformConfig["objectStorage"] {
  const endpoint = validateHttpUrl(
    readRuntimeValue(
      environment,
      "OBJECT_STORAGE_ENDPOINT",
      mode,
      DEFAULT_OBJECT_STORAGE_ENDPOINT,
    ),
    "OBJECT_STORAGE_ENDPOINT",
  );
  if (mode === "production" && new URL(endpoint).protocol !== "https:") {
    throw new Error("OBJECT_STORAGE_ENDPOINT must use HTTPS in production mode");
  }
  const bucket = (name: "OBJECT_STORAGE_PROTECTED_BUCKET" | "OBJECT_STORAGE_PUBLIC_BUCKET" | "OBJECT_STORAGE_QUARANTINE_BUCKET", fallback: string) => {
    const value = readRuntimeValue(environment, name, mode, fallback);
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value)) {
      throw new Error(`${name} must be a valid S3 bucket name`);
    }
    return value;
  };
  const buckets = Object.freeze({
    protected: bucket("OBJECT_STORAGE_PROTECTED_BUCKET", DEFAULT_OBJECT_STORAGE_PROTECTED_BUCKET),
    public: bucket("OBJECT_STORAGE_PUBLIC_BUCKET", DEFAULT_OBJECT_STORAGE_PUBLIC_BUCKET),
    quarantine: bucket("OBJECT_STORAGE_QUARANTINE_BUCKET", DEFAULT_OBJECT_STORAGE_QUARANTINE_BUCKET),
  });
  if (new Set(Object.values(buckets)).size !== 3) {
    throw new Error("Object Storage buckets must be distinct");
  }
  return Object.freeze({
    accessKeyId: readRuntimeValue(environment, "OBJECT_STORAGE_ACCESS_KEY_ID", mode, DEFAULT_OBJECT_STORAGE_ACCESS_KEY_ID),
    buckets,
    endpoint,
    forcePathStyle: environment.OBJECT_STORAGE_FORCE_PATH_STYLE?.trim() === "true" || mode !== "production",
    orphanGraceMs: parseBoundedSeconds(
      readRuntimeValue(environment, "MATERIAL_ASSET_ORPHAN_GRACE_SECONDS", mode, DEFAULT_MATERIAL_ASSET_ORPHAN_GRACE_SECONDS),
      "MATERIAL_ASSET_ORPHAN_GRACE_SECONDS",
      3600,
      2_592_000,
    ) * 1_000,
    region: readRuntimeValue(environment, "OBJECT_STORAGE_REGION", mode, DEFAULT_OBJECT_STORAGE_REGION),
    secretAccessKey: readRuntimeValue(environment, "OBJECT_STORAGE_SECRET_ACCESS_KEY", mode, DEFAULT_OBJECT_STORAGE_SECRET_ACCESS_KEY),
    signedGetTtlSeconds: parseBoundedSeconds(
      readRuntimeValue(environment, "OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS", mode, DEFAULT_OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS),
      "OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS",
      1,
      300,
    ),
  });
}

function parseTelegramLinkLifetime(value: string): number {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 600) {
    throw new Error(
      "TELEGRAM_LINK_LIFETIME_SECONDS must be an integer between 60 and 600",
    );
  }
  return seconds * 1_000;
}

function validateHttpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  return value;
}

function parseIdentityConfig(
  environment: NodeJS.ProcessEnv,
  mode: PlatformMode,
): PlatformConfig["identity"] {
  const issuer = validateHttpUrl(
    readRuntimeValue(environment, "LOGTO_ISSUER", mode, DEFAULT_LOGTO_ISSUER),
    "LOGTO_ISSUER",
  );
  if (new URL(issuer).protocol !== "https:") {
    throw new Error("LOGTO_ISSUER must use HTTPS");
  }
  const audience = validateHttpUrl(
    readRuntimeValue(environment, "LOGTO_AUDIENCE", mode, DEFAULT_LOGTO_AUDIENCE),
    "LOGTO_AUDIENCE",
  );
  const jwksUrl = validateHttpUrl(
    readRuntimeValue(environment, "LOGTO_JWKS_URL", mode, DEFAULT_LOGTO_JWKS_URL),
    "LOGTO_JWKS_URL",
  );
  if (mode === "production" && new URL(jwksUrl).protocol !== "https:") {
    throw new Error("LOGTO_JWKS_URL must use HTTPS in production mode");
  }
  const emailFingerprintKey = readRuntimeValue(
    environment,
    "IDENTITY_EMAIL_FINGERPRINT_KEY",
    mode,
    DEFAULT_EMAIL_FINGERPRINT_KEY,
  );
  if (emailFingerprintKey.length < 32) {
    throw new Error("IDENTITY_EMAIL_FINGERPRINT_KEY must contain at least 32 characters");
  }

  return Object.freeze({ issuer, audience, jwksUrl, emailFingerprintKey });
}

function parseTelegramMembershipConfig(
  environment: NodeJS.ProcessEnv,
  mode: PlatformMode,
): PlatformConfig["telegramMembership"] {
  const botStartUrl = validateHttpUrl(
    readRuntimeValue(
      environment,
      "TELEGRAM_BOT_START_URL",
      mode,
      DEFAULT_TELEGRAM_BOT_START_URL,
    ),
    "TELEGRAM_BOT_START_URL",
  );
  const botUrl = new URL(botStartUrl);
  if (
    botUrl.protocol !== "https:" ||
    botUrl.hostname !== "t.me" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(botUrl.pathname) ||
    botUrl.search.length > 0 ||
    botUrl.hash.length > 0
  ) {
    throw new Error(
      "TELEGRAM_BOT_START_URL must be a t.me bot deep-link base URL",
    );
  }
  const linkingEndpoint = validateHttpUrl(
    readRuntimeValue(
      environment,
      "TELEGRAM_LINKING_ENDPOINT",
      mode,
      DEFAULT_TELEGRAM_LINKING_ENDPOINT,
    ),
    "TELEGRAM_LINKING_ENDPOINT",
  );
  const linkingUrl = new URL(linkingEndpoint);
  if (
    (mode === "production" && linkingUrl.protocol !== "https:") ||
    linkingUrl.username.length > 0 ||
    linkingUrl.password.length > 0 ||
    linkingUrl.search.length > 0 ||
    linkingUrl.hash.length > 0 ||
    !linkingUrl.pathname.endsWith("/integrations/platform/v1/identity-links")
  ) {
    throw new Error("TELEGRAM_LINKING_ENDPOINT is invalid");
  }
  const linkingSecret = telegramSecret(
    readRuntimeValue(
      environment,
      "TELEGRAM_LINKING_SECRET",
      mode,
      DEFAULT_TELEGRAM_LINKING_SECRET,
    ),
    "TELEGRAM_LINKING_SECRET",
  );
  const evidenceIngressSecret = telegramSecret(
    readRuntimeValue(
      environment,
      "TELEGRAM_EVIDENCE_INGRESS_SECRET",
      mode,
      DEFAULT_TELEGRAM_EVIDENCE_INGRESS_SECRET,
    ),
    "TELEGRAM_EVIDENCE_INGRESS_SECRET",
  );
  const linkLifetimeMs = parseTelegramLinkLifetime(
    readRuntimeValue(
      environment,
      "TELEGRAM_LINK_LIFETIME_SECONDS",
      mode,
      DEFAULT_TELEGRAM_LINK_LIFETIME_SECONDS,
    ),
  );
  return Object.freeze({
    botStartUrl,
    evidenceIngressSecret,
    linkingEndpoint,
    linkingSecret,
    linkLifetimeMs,
  });
}

function telegramSecret(value: string, name: string): string {
  if (!/^[A-Za-z0-9_-]{16,256}$/u.test(value)) {
    throw new Error(`${name} must be a base64url credential of at least 16 characters`);
  }
  return value;
}

export function parsePlatformConfig(
  environment: NodeJS.ProcessEnv,
): PlatformConfig {
  const mode = parseMode(environment.NODE_ENV);
  const database = parsePlatformDatabaseConfig(environment, mode);
  const api = Object.freeze({
    host: readRuntimeValue(environment, "API_HOST", mode, DEFAULT_API_HOST),
    port: parseApiPort(
      readRuntimeValue(environment, "API_PORT", mode, DEFAULT_API_PORT),
    ),
  });
  const identity = parseIdentityConfig(environment, mode);
  const contentAccess = Object.freeze({
    membershipAcquisitionUrl: validateHttpUrl(
      readRuntimeValue(
        environment,
        "MEMBERSHIP_ACQUISITION_URL",
        mode,
        DEFAULT_MEMBERSHIP_ACQUISITION_URL,
      ),
      "MEMBERSHIP_ACQUISITION_URL",
    ),
  });
  const telegramMembership = parseTelegramMembershipConfig(environment, mode);
  const objectStorage = parseObjectStorageConfig(environment, mode);

  return Object.freeze({
    mode,
    database,
    api,
    identity,
    contentAccess,
    objectStorage,
    telegramMembership,
  });
}

export function parsePlatformDatabaseConfig(
  environment: NodeJS.ProcessEnv,
  mode: PlatformMode = parseMode(environment.NODE_ENV),
): PlatformDatabaseConfig {
  return Object.freeze({
    url: validateDatabaseUrl(
      readRuntimeValue(
        environment,
        "DATABASE_URL",
        mode,
        DEFAULT_DATABASE_URL,
      ),
    ),
  });
}
