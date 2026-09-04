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
const DEFAULT_KINESCOPE_PROVIDER_MODE = "test";
const DEFAULT_KINESCOPE_API_BASE_URL = "https://api.kinescope.io";
const DEFAULT_KINESCOPE_UPLOADER_BASE_URL = "https://uploader.kinescope.io";
const DEFAULT_KINESCOPE_API_TOKEN = "inside-local-kinescope-api-token";
const DEFAULT_KINESCOPE_PUBLIC_PROJECT_ID = "inside-local-public-project";
const DEFAULT_KINESCOPE_MEMBERSHIP_PROJECT_ID = "inside-local-membership-project";
const DEFAULT_KINESCOPE_CALLBACK_USERNAME = "inside-local-callback";
const DEFAULT_KINESCOPE_CALLBACK_PASSWORD = "inside-local-callback-password";
const DEFAULT_KINESCOPE_WEBHOOK_USERNAME = "inside-local-webhook";
const DEFAULT_KINESCOPE_WEBHOOK_PASSWORD = "inside-local-webhook-password";
const DEFAULT_KINESCOPE_PLAYBACK_JWT_SECRET = "inside-local-kinescope-playback-secret";
const DEFAULT_KINESCOPE_PLAYBACK_JWT_TTL_SECONDS = "60";

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
const kinescopeUrlSchema = (name: string) =>
  httpUrlSchema(name).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "kinescope.io" || url.hostname.endsWith(".kinescope.io"));
  }, { message: `${name} must use HTTPS on a Kinescope host` });
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
    supportUrl: httpUrlSchema("MEMBERSHIP_SUPPORT_URL").optional(),
  })
  .readonly();
const kinescopeSchema = z.object({
  apiBaseUrl: kinescopeUrlSchema("KINESCOPE_API_BASE_URL"),
  apiToken: z.string().min(16),
  callbackPassword: z.string().min(16),
  callbackUsername: z.string().min(1),
  membershipProjectId: z.string().min(1).max(128),
  playbackJwtSecret: z.string().min(32),
  playbackJwtTtlSeconds: integerStringSchema(
    "KINESCOPE_PLAYBACK_JWT_TTL_SECONDS must be an integer between 30 and 300",
    30,
    300,
  ),
  providerMode: z.enum(["real", "test"]),
  publicProjectId: z.string().min(1).max(128),
  uploaderBaseUrl: kinescopeUrlSchema("KINESCOPE_UPLOADER_BASE_URL"),
  webhookPassword: z.string().min(16),
  webhookUsername: z.string().min(1),
}).readonly();
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
    kinescope: kinescopeSchema,
    telegramMembership: telegramMembershipSchema,
  })
  .readonly();
const platformDatabaseConfigSchema = z
  .object({ url: databaseUrlSchema })
  .readonly();

export type PlatformMode = z.infer<typeof platformModeSchema>;
export type PlatformConfig = z.infer<typeof platformConfigSchema>;
export type BackendProcess =
  | "api"
  | "material-assets-worker"
  | "mcp"
  | "profile-avatars-worker"
  | "video-deletions-worker";
export type PlatformDatabaseConfig = z.infer<
  typeof platformDatabaseConfigSchema
>;

const unusedProductionGroups = {
  api: {
    API_HOST: "127.0.0.1",
    API_PORT: "3001",
  },
  contentAccess: {
    MEMBERSHIP_ACQUISITION_URL: "https://unused.invalid/membership",
  },
  identity: {
    IDENTITY_EMAIL_FINGERPRINT_KEY: "unused-email-fingerprint-key-32-chars",
    LOGTO_AUDIENCE: "https://unused.invalid/api",
    LOGTO_ISSUER: "https://unused.invalid/oidc",
    LOGTO_JWKS_URL: "https://unused.invalid/oidc/jwks",
  },
  kinescope: {
    KINESCOPE_API_BASE_URL: "https://api.kinescope.io",
    KINESCOPE_API_TOKEN: "unused-kinescope-api-token",
    KINESCOPE_CALLBACK_PASSWORD: "unused-callback-password",
    KINESCOPE_CALLBACK_USERNAME: "unused-callback-user",
    KINESCOPE_MEMBERSHIP_PROJECT_ID: "unused-membership-project",
    KINESCOPE_PLAYBACK_JWT_SECRET: "unused-playback-secret-at-least-32-characters",
    KINESCOPE_PLAYBACK_JWT_TTL_SECONDS: "60",
    KINESCOPE_PROVIDER_MODE: "real",
    KINESCOPE_PUBLIC_PROJECT_ID: "unused-public-project",
    KINESCOPE_UPLOADER_BASE_URL: "https://uploader.kinescope.io",
    KINESCOPE_WEBHOOK_PASSWORD: "unused-webhook-password",
    KINESCOPE_WEBHOOK_USERNAME: "unused-webhook-user",
  },
  objectStorage: {
    MATERIAL_ASSET_ORPHAN_GRACE_SECONDS: "86400",
    OBJECT_STORAGE_ACCESS_KEY_ID: "unused-access-key",
    OBJECT_STORAGE_ENDPOINT: "https://unused.invalid",
    OBJECT_STORAGE_FORCE_PATH_STYLE: "false",
    OBJECT_STORAGE_PROTECTED_BUCKET: "unused-protected",
    OBJECT_STORAGE_PUBLIC_BUCKET: "unused-public",
    OBJECT_STORAGE_QUARANTINE_BUCKET: "unused-quarantine",
    OBJECT_STORAGE_REGION: "unused-region",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "unused-secret-key",
    OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS: "60",
    PROFILE_AVATAR_ORPHAN_GRACE_SECONDS: "86400",
  },
  telegramMembership: {
    TELEGRAM_BOT_START_URL: "https://t.me/unused_bot",
    TELEGRAM_EVIDENCE_INGRESS_SECRET: "unused-evidence-secret",
    TELEGRAM_LINKING_ENDPOINT:
      "https://unused.invalid/integrations/platform/v1/identity-links",
    TELEGRAM_LINKING_SECRET: "unused-linking-secret",
    TELEGRAM_LINK_LIFETIME_SECONDS: "300",
  },
} as const;

const requiredGroupsByProcess = {
  api: new Set(Object.keys(unusedProductionGroups)),
  "material-assets-worker": new Set(["objectStorage"]),
  mcp: new Set(["contentAccess", "identity", "kinescope", "objectStorage"]),
  "profile-avatars-worker": new Set(["objectStorage"]),
  "video-deletions-worker": new Set(["kinescope"]),
} satisfies Record<BackendProcess, ReadonlySet<string>>;

export function parsePlatformProcessConfig(
  environment: NodeJS.ProcessEnv,
  process: BackendProcess,
): PlatformConfig {
  if (parsePlatformMode(environment.NODE_ENV) !== "production") {
    return parsePlatformConfig(environment);
  }
  const effectiveEnvironment = { ...environment };
  for (const [group, values] of Object.entries(unusedProductionGroups)) {
    if (!requiredGroupsByProcess[process].has(group)) {
      for (const [name, value] of Object.entries(values)) {
        effectiveEnvironment[name] ??= value;
      }
    }
  }
  return parsePlatformConfig(effectiveEnvironment);
}

export function parsePlatformConfig(
  environment: NodeJS.ProcessEnv,
): PlatformConfig {
  const mode = parsePlatformMode(environment.NODE_ENV);
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
    kinescope: {
      apiBaseUrl: readRuntimeValue(environment, "KINESCOPE_API_BASE_URL", mode, DEFAULT_KINESCOPE_API_BASE_URL),
      apiToken: readRuntimeValue(environment, "KINESCOPE_API_TOKEN", mode, DEFAULT_KINESCOPE_API_TOKEN),
      callbackPassword: readRuntimeValue(environment, "KINESCOPE_CALLBACK_PASSWORD", mode, DEFAULT_KINESCOPE_CALLBACK_PASSWORD),
      callbackUsername: readRuntimeValue(environment, "KINESCOPE_CALLBACK_USERNAME", mode, DEFAULT_KINESCOPE_CALLBACK_USERNAME),
      membershipProjectId: readRuntimeValue(environment, "KINESCOPE_MEMBERSHIP_PROJECT_ID", mode, DEFAULT_KINESCOPE_MEMBERSHIP_PROJECT_ID),
      playbackJwtSecret: readRuntimeValue(environment, "KINESCOPE_PLAYBACK_JWT_SECRET", mode, DEFAULT_KINESCOPE_PLAYBACK_JWT_SECRET),
      playbackJwtTtlSeconds: readRuntimeValue(environment, "KINESCOPE_PLAYBACK_JWT_TTL_SECONDS", mode, DEFAULT_KINESCOPE_PLAYBACK_JWT_TTL_SECONDS),
      providerMode: environment.KINESCOPE_PROVIDER_MODE?.trim() || (mode === "production" ? "real" : DEFAULT_KINESCOPE_PROVIDER_MODE),
      publicProjectId: readRuntimeValue(environment, "KINESCOPE_PUBLIC_PROJECT_ID", mode, DEFAULT_KINESCOPE_PUBLIC_PROJECT_ID),
      uploaderBaseUrl: readRuntimeValue(environment, "KINESCOPE_UPLOADER_BASE_URL", mode, DEFAULT_KINESCOPE_UPLOADER_BASE_URL),
      webhookPassword: readRuntimeValue(environment, "KINESCOPE_WEBHOOK_PASSWORD", mode, DEFAULT_KINESCOPE_WEBHOOK_PASSWORD),
      webhookUsername: readRuntimeValue(environment, "KINESCOPE_WEBHOOK_USERNAME", mode, DEFAULT_KINESCOPE_WEBHOOK_USERNAME),
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
      supportUrl: readOptionalRuntimeValue(
        environment,
        "MEMBERSHIP_SUPPORT_URL",
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

  if (mode === "production" && config.data.kinescope.providerMode !== "real") {
    throw new Error("KINESCOPE_PROVIDER_MODE must be real in production mode");
  }
  if (config.data.kinescope.publicProjectId === config.data.kinescope.membershipProjectId) {
    throw new Error("Public and membership Kinescope projects must be distinct");
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
  mode: PlatformMode = parsePlatformMode(environment.NODE_ENV),
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

export function parsePlatformMode(value: string | undefined): PlatformMode {
  const mode = platformModeSchema.safeParse(value ?? "production");
  if (!mode.success) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  return mode.data;
}

function readOptionalRuntimeValue(
  environment: NodeJS.ProcessEnv,
  name: "MEMBERSHIP_SUPPORT_URL",
): string | undefined {
  const value = environment[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
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
    | "KINESCOPE_API_BASE_URL"
    | "KINESCOPE_API_TOKEN"
    | "KINESCOPE_CALLBACK_PASSWORD"
    | "KINESCOPE_CALLBACK_USERNAME"
    | "KINESCOPE_MEMBERSHIP_PROJECT_ID"
    | "KINESCOPE_PLAYBACK_JWT_SECRET"
    | "KINESCOPE_PLAYBACK_JWT_TTL_SECONDS"
    | "KINESCOPE_PUBLIC_PROJECT_ID"
    | "KINESCOPE_UPLOADER_BASE_URL"
    | "KINESCOPE_WEBHOOK_PASSWORD"
    | "KINESCOPE_WEBHOOK_USERNAME"
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
