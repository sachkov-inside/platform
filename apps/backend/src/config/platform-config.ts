import { z } from "zod";

const DEFAULT_DATABASE_URL =
  "postgresql://inside:inside@127.0.0.1:5432/inside";
const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = "3001";
const DEFAULT_LOGTO_ISSUER = "https://identity.inside.localhost:3301/oidc";
const DEFAULT_LOGTO_AUDIENCE = "http://127.0.0.1:3001";
const DEFAULT_LOGTO_JWKS_URL =
  "https://identity.inside.localhost:3301/oidc/jwks";
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
const DEFAULT_PROFILE_AVATAR_ORPHAN_GRACE_SECONDS = "86400";

export const PLATFORM_CONFIG = Symbol("PLATFORM_CONFIG");

const platformModeSchema = z.enum(["development", "test", "production"]);
const databaseUrlSchema = absoluteUrlSchema("DATABASE_URL").refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === "postgres:" || protocol === "postgresql:";
  },
  { message: "DATABASE_URL must use the postgres or postgresql protocol" },
);
const apiPortSchema = integerStringSchema(
  "API_PORT must be an integer between 1 and 65535",
  1,
  65_535,
);
const identitySchema = z
  .object({
    issuer: httpUrlSchema("LOGTO_ISSUER").refine(
      (value) => new URL(value).protocol === "https:",
      { message: "LOGTO_ISSUER must use HTTPS" },
    ),
    audience: httpUrlSchema("LOGTO_AUDIENCE"),
    jwksUrl: httpUrlSchema("LOGTO_JWKS_URL"),
    emailFingerprintKey: z.string().min(32, {
      message:
        "IDENTITY_EMAIL_FINGERPRINT_KEY must contain at least 32 characters",
    }),
  })
  .readonly();
const contentAccessSchema = z
  .object({
    membershipAcquisitionUrl: httpUrlSchema("MEMBERSHIP_ACQUISITION_URL"),
  })
  .readonly();
const objectStorageBucketSchema = (name: string) =>
  z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u, {
    message: `${name} must be a valid S3 bucket name`,
  });
const objectStorageSchema = z
  .object({
    accessKeyId: z.string().min(1, {
      message: "OBJECT_STORAGE_ACCESS_KEY_ID must not be empty",
    }),
    buckets: z
      .object({
        protected: objectStorageBucketSchema(
          "OBJECT_STORAGE_PROTECTED_BUCKET",
        ),
        public: objectStorageBucketSchema("OBJECT_STORAGE_PUBLIC_BUCKET"),
        quarantine: objectStorageBucketSchema(
          "OBJECT_STORAGE_QUARANTINE_BUCKET",
        ),
      })
      .readonly(),
    endpoint: httpUrlSchema("OBJECT_STORAGE_ENDPOINT"),
    forcePathStyle: z
      .string()
      .regex(/^(?:true|false)$/u, {
        message: "OBJECT_STORAGE_FORCE_PATH_STYLE must be true or false",
      })
      .transform((value) => value === "true"),
    orphanGraceMs: integerStringSchema(
      "MATERIAL_ASSET_ORPHAN_GRACE_SECONDS must be an integer between 3600 and 2592000",
      3_600,
      2_592_000,
    ).transform((seconds) => seconds * 1_000),
    profileAvatarOrphanGraceMs: integerStringSchema(
      "PROFILE_AVATAR_ORPHAN_GRACE_SECONDS must be an integer between 3600 and 2592000",
      3_600,
      2_592_000,
    ).transform((seconds) => seconds * 1_000),
    region: z.string().min(1, {
      message: "OBJECT_STORAGE_REGION must not be empty",
    }),
    secretAccessKey: z.string().min(1, {
      message: "OBJECT_STORAGE_SECRET_ACCESS_KEY must not be empty",
    }),
    signedGetTtlSeconds: integerStringSchema(
      "OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS must be an integer between 1 and 300",
      1,
      300,
    ),
  })
  .readonly();
const telegramSecretSchema = (name: string) =>
  z.string().regex(/^[A-Za-z0-9_-]{16,256}$/u, {
    message: `${name} must be a base64url credential of at least 16 characters`,
  });
const telegramMembershipSchema = z
  .object({
    botStartUrl: httpUrlSchema("TELEGRAM_BOT_START_URL").refine(
      (value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.hostname === "t.me" &&
          /^\/[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(url.pathname) &&
          url.search.length === 0 &&
          url.hash.length === 0
        );
      },
      {
        message:
          "TELEGRAM_BOT_START_URL must be a t.me bot deep-link base URL",
      },
    ),
    evidenceIngressSecret: telegramSecretSchema(
      "TELEGRAM_EVIDENCE_INGRESS_SECRET",
    ),
    linkingEndpoint: httpUrlSchema("TELEGRAM_LINKING_ENDPOINT"),
    linkingSecret: telegramSecretSchema("TELEGRAM_LINKING_SECRET"),
    linkLifetimeMs: integerStringSchema(
      "TELEGRAM_LINK_LIFETIME_SECONDS must be an integer between 60 and 600",
      60,
      600,
    ).transform((seconds) => seconds * 1_000),
  })
  .readonly();
const platformConfigSchema = z
  .object({
    mode: platformModeSchema,
    database: z.object({ url: databaseUrlSchema }).readonly(),
    api: z
      .object({
        host: z.string().trim().min(1, {
          message: "API_HOST must be a non-empty listen address",
        }),
        port: apiPortSchema,
      })
      .readonly(),
    identity: identitySchema,
    contentAccess: contentAccessSchema,
    objectStorage: objectStorageSchema,
    telegramMembership: telegramMembershipSchema,
  })
  .readonly();
const platformDatabaseConfigSchema = z
  .object({ url: databaseUrlSchema })
  .readonly();

export type PlatformMode = z.infer<typeof platformModeSchema>;
export type PlatformConfig = z.infer<typeof platformConfigSchema>;
export type PlatformDatabaseConfig = z.infer<
  typeof platformDatabaseConfigSchema
>;

export function parsePlatformConfig(
  environment: NodeJS.ProcessEnv,
): PlatformConfig {
  const mode = parseMode(environment.NODE_ENV);
  const config = platformConfigSchema.safeParse({
    mode,
    database: parsePlatformDatabaseConfig(environment, mode),
    api: {
      host: readRuntimeValue(
        environment,
        "API_HOST",
        mode,
        DEFAULT_API_HOST,
      ),
      port: readRuntimeValue(
        environment,
        "API_PORT",
        mode,
        DEFAULT_API_PORT,
      ),
    },
    identity: {
      issuer: readRuntimeValue(
        environment,
        "LOGTO_ISSUER",
        mode,
        DEFAULT_LOGTO_ISSUER,
      ),
      audience: readRuntimeValue(
        environment,
        "LOGTO_AUDIENCE",
        mode,
        DEFAULT_LOGTO_AUDIENCE,
      ),
      jwksUrl: readRuntimeValue(
        environment,
        "LOGTO_JWKS_URL",
        mode,
        DEFAULT_LOGTO_JWKS_URL,
      ),
      emailFingerprintKey: readRuntimeValue(
        environment,
        "IDENTITY_EMAIL_FINGERPRINT_KEY",
        mode,
        DEFAULT_EMAIL_FINGERPRINT_KEY,
      ),
    },
    contentAccess: {
      membershipAcquisitionUrl: readRuntimeValue(
        environment,
        "MEMBERSHIP_ACQUISITION_URL",
        mode,
        DEFAULT_MEMBERSHIP_ACQUISITION_URL,
      ),
    },
    objectStorage: {
      accessKeyId: readRuntimeValue(
        environment,
        "OBJECT_STORAGE_ACCESS_KEY_ID",
        mode,
        DEFAULT_OBJECT_STORAGE_ACCESS_KEY_ID,
      ),
      buckets: {
        protected: readRuntimeValue(
          environment,
          "OBJECT_STORAGE_PROTECTED_BUCKET",
          mode,
          DEFAULT_OBJECT_STORAGE_PROTECTED_BUCKET,
        ),
        public: readRuntimeValue(
          environment,
          "OBJECT_STORAGE_PUBLIC_BUCKET",
          mode,
          DEFAULT_OBJECT_STORAGE_PUBLIC_BUCKET,
        ),
        quarantine: readRuntimeValue(
          environment,
          "OBJECT_STORAGE_QUARANTINE_BUCKET",
          mode,
          DEFAULT_OBJECT_STORAGE_QUARANTINE_BUCKET,
        ),
      },
      endpoint: readRuntimeValue(
        environment,
        "OBJECT_STORAGE_ENDPOINT",
        mode,
        DEFAULT_OBJECT_STORAGE_ENDPOINT,
      ),
      forcePathStyle:
        environment.OBJECT_STORAGE_FORCE_PATH_STYLE?.trim() ||
        (mode === "production" ? "false" : "true"),
      orphanGraceMs: readRuntimeValue(
        environment,
        "MATERIAL_ASSET_ORPHAN_GRACE_SECONDS",
        mode,
        DEFAULT_MATERIAL_ASSET_ORPHAN_GRACE_SECONDS,
      ),
      profileAvatarOrphanGraceMs: readRuntimeValue(
        environment,
        "PROFILE_AVATAR_ORPHAN_GRACE_SECONDS",
        mode,
        DEFAULT_PROFILE_AVATAR_ORPHAN_GRACE_SECONDS,
      ),
      region: readRuntimeValue(
        environment,
        "OBJECT_STORAGE_REGION",
        mode,
        DEFAULT_OBJECT_STORAGE_REGION,
      ),
      secretAccessKey: readRuntimeValue(
        environment,
        "OBJECT_STORAGE_SECRET_ACCESS_KEY",
        mode,
        DEFAULT_OBJECT_STORAGE_SECRET_ACCESS_KEY,
      ),
      signedGetTtlSeconds: readRuntimeValue(
        environment,
        "OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS",
        mode,
        DEFAULT_OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS,
      ),
    },
    telegramMembership: {
      botStartUrl: readRuntimeValue(
        environment,
        "TELEGRAM_BOT_START_URL",
        mode,
        DEFAULT_TELEGRAM_BOT_START_URL,
      ),
      evidenceIngressSecret: readRuntimeValue(
        environment,
        "TELEGRAM_EVIDENCE_INGRESS_SECRET",
        mode,
        DEFAULT_TELEGRAM_EVIDENCE_INGRESS_SECRET,
      ),
      linkingEndpoint: readRuntimeValue(
        environment,
        "TELEGRAM_LINKING_ENDPOINT",
        mode,
        DEFAULT_TELEGRAM_LINKING_ENDPOINT,
      ),
      linkingSecret: readRuntimeValue(
        environment,
        "TELEGRAM_LINKING_SECRET",
        mode,
        DEFAULT_TELEGRAM_LINKING_SECRET,
      ),
      linkLifetimeMs: readRuntimeValue(
        environment,
        "TELEGRAM_LINK_LIFETIME_SECONDS",
        mode,
        DEFAULT_TELEGRAM_LINK_LIFETIME_SECONDS,
      ),
    },
  });

  if (!config.success) {
    throw new Error(firstIssue(config.error));
  }

  if (
    mode === "production" &&
    new URL(config.data.identity.jwksUrl).protocol !== "https:"
  ) {
    throw new Error("LOGTO_JWKS_URL must use HTTPS in production mode");
  }

  if (
    mode === "production" &&
    new URL(config.data.objectStorage.endpoint).protocol !== "https:"
  ) {
    throw new Error("OBJECT_STORAGE_ENDPOINT must use HTTPS in production mode");
  }

  if (new Set(Object.values(config.data.objectStorage.buckets)).size !== 3) {
    throw new Error("Object Storage buckets must be distinct");
  }

  const linkingUrl = new URL(
    config.data.telegramMembership.linkingEndpoint,
  );
  if (
    (mode === "production" && linkingUrl.protocol !== "https:") ||
    linkingUrl.username.length > 0 ||
    linkingUrl.password.length > 0 ||
    linkingUrl.search.length > 0 ||
    linkingUrl.hash.length > 0 ||
    !linkingUrl.pathname.endsWith(
      "/integrations/platform/v1/identity-links",
    )
  ) {
    throw new Error("TELEGRAM_LINKING_ENDPOINT is invalid");
  }

  return config.data;
}

export function parsePlatformDatabaseConfig(
  environment: NodeJS.ProcessEnv,
  mode: PlatformMode = parseMode(environment.NODE_ENV),
): PlatformDatabaseConfig {
  const config = platformDatabaseConfigSchema.safeParse({
    url: readRuntimeValue(
      environment,
      "DATABASE_URL",
      mode,
      DEFAULT_DATABASE_URL,
    ),
  });
  if (!config.success) {
    throw new Error(firstIssue(config.error));
  }
  return config.data;
}

function parseMode(value: string | undefined): PlatformMode {
  const mode = platformModeSchema.safeParse(value ?? "production");
  if (!mode.success) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  return mode.data;
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
    | "PROFILE_AVATAR_ORPHAN_GRACE_SECONDS"
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

function absoluteUrlSchema(name: string) {
  return z.url({ message: `${name} must be a valid URL` });
}

function httpUrlSchema(name: string) {
  return absoluteUrlSchema(name).refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    },
    { message: `${name} must use HTTP or HTTPS` },
  );
}

function integerStringSchema(message: string, minimum: number, maximum: number) {
  return z
    .string()
    .refine(
      (value) => {
        const number = Number(value);
        return (
          Number.isInteger(number) && number >= minimum && number <= maximum
        );
      },
      { message },
    )
    .transform(Number);
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Platform configuration is invalid";
}
