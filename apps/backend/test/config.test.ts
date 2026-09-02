import { describe, expect, it } from "vitest";

import { parseMcpConfig } from "../src/config/mcp-config.js";
import {
  parsePlatformConfig,
  parsePlatformDatabaseConfig,
} from "../src/config/platform-config.js";

describe("process configuration", () => {
  it("parses and freezes one config without mutating process.env", () => {
    const processEnvironmentBefore = { ...process.env };

    const config = parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://database.example/inside",
      API_HOST: "api.example",
      API_PORT: "4100",
      LOGTO_ISSUER: "https://identity.example.test/oidc",
      LOGTO_AUDIENCE: "https://api.example.test",
      LOGTO_JWKS_URL: "https://identity.example.test/oidc/jwks",
      IDENTITY_EMAIL_FINGERPRINT_KEY: "test-email-fingerprint-key-32chars",
      MEMBERSHIP_ACQUISITION_URL: "https://t.me/tribute/example",
      TELEGRAM_BOT_START_URL: "https://t.me/inside_test_bot",
      TELEGRAM_EVIDENCE_INGRESS_SECRET:
        "test-telegram-evidence-ingress-secret",
      TELEGRAM_LINKING_ENDPOINT:
        "https://telegram.example.test/integrations/platform/v1/identity-links",
      TELEGRAM_LINKING_SECRET: "test-telegram-linking-secret",
      TELEGRAM_LINK_LIFETIME_SECONDS: "420",
    });

    expect(config).toEqual({
      mode: "test",
      database: { url: "postgresql://database.example/inside" },
      api: { host: "api.example", port: 4100 },
      identity: {
        issuer: "https://identity.example.test/oidc",
        audience: "https://api.example.test",
        jwksUrl: "https://identity.example.test/oidc/jwks",
        emailFingerprintKey: "test-email-fingerprint-key-32chars",
      },
      contentAccess: {
        membershipAcquisitionUrl: "https://t.me/tribute/example",
      },
      kinescope: localKinescopeConfig,
      objectStorage: {
        accessKeyId: "inside-local-access-key",
        buckets: {
          protected: "inside-local-protected",
          public: "inside-local-public",
          quarantine: "inside-local-quarantine",
        },
        endpoint: "http://127.0.0.1:9000",
        forcePathStyle: true,
        orphanGraceMs: 86_400_000,
        profileAvatarOrphanGraceMs: 86_400_000,
        region: "ru-central1",
        secretAccessKey: "inside-local-secret-key",
        signedGetTtlSeconds: 60,
      },
      telegramMembership: {
        botStartUrl: "https://t.me/inside_test_bot",
        evidenceIngressSecret: "test-telegram-evidence-ingress-secret",
        linkingEndpoint:
          "https://telegram.example.test/integrations/platform/v1/identity-links",
        linkingSecret: "test-telegram-linking-secret",
        linkLifetimeMs: 420_000,
      },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
    expect(Object.isFrozen(config.api)).toBe(true);
    expect(Object.isFrozen(config.identity)).toBe(true);
    expect(Object.isFrozen(config.contentAccess)).toBe(true);
    expect(Object.isFrozen(config.kinescope)).toBe(true);
    expect(Object.isFrozen(config.objectStorage)).toBe(true);
    expect(Object.isFrozen(config.objectStorage.buckets)).toBe(true);
    expect(Object.isFrozen(config.telegramMembership)).toBe(true);
    expect(process.env).toEqual(processEnvironmentBefore);
  });

  it("uses local defaults only in explicit development or test mode", () => {
    expect(parsePlatformConfig({ NODE_ENV: "development" })).toEqual({
      mode: "development",
      database: {
        url: "postgresql://inside:inside@127.0.0.1:5432/inside",
      },
      api: { host: "127.0.0.1", port: 3001 },
      identity: {
        issuer: "https://identity.inside.localhost:3301/oidc",
        audience: "http://127.0.0.1:3001",
        jwksUrl: "https://identity.inside.localhost:3301/oidc/jwks",
        emailFingerprintKey: "inside-local-email-fingerprint-key",
      },
      contentAccess: {
        membershipAcquisitionUrl: "https://t.me/tribute",
      },
      kinescope: localKinescopeConfig,
      objectStorage: {
        accessKeyId: "inside-local-access-key",
        buckets: {
          protected: "inside-local-protected",
          public: "inside-local-public",
          quarantine: "inside-local-quarantine",
        },
        endpoint: "http://127.0.0.1:9000",
        forcePathStyle: true,
        orphanGraceMs: 86_400_000,
        profileAvatarOrphanGraceMs: 86_400_000,
        region: "ru-central1",
        secretAccessKey: "inside-local-secret-key",
        signedGetTtlSeconds: 60,
      },
      telegramMembership: {
        botStartUrl: "https://t.me/inside_local_bot",
        evidenceIngressSecret: "inside-local-telegram-evidence-secret",
        linkingEndpoint:
          "http://127.0.0.1:3002/integrations/platform/v1/identity-links",
        linkingSecret: "inside-local-telegram-link-secret",
        linkLifetimeMs: 300_000,
      },
    });

    expect(() => parsePlatformConfig({})).toThrow(
      "DATABASE_URL is required in production mode",
    );
  });

  it("requires production database and listen values", () => {
    expect(() =>
      parsePlatformConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://database.example/inside",
      }),
    ).toThrow("API_HOST is required in production mode");

    expect(() =>
      parsePlatformConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://database.example/inside",
        API_HOST: "0.0.0.0",
      }),
    ).toThrow("API_PORT is required in production mode");

    expect(() =>
      parsePlatformConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://database.example/inside",
        API_HOST: "0.0.0.0",
        API_PORT: "3001",
        LOGTO_ISSUER: "https://identity.example.test/oidc",
        LOGTO_AUDIENCE: "https://api.example.test",
        LOGTO_JWKS_URL: "https://identity.example.test/oidc/jwks",
        IDENTITY_EMAIL_FINGERPRINT_KEY:
          "production-email-fingerprint-key-32chars",
      }),
    ).toThrow("MEMBERSHIP_ACQUISITION_URL is required in production mode");
  });

  it("parses production database config for non-listening migration tooling", () => {
    expect(
      parsePlatformDatabaseConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://database.example/inside",
      }),
    ).toEqual({ url: "postgresql://database.example/inside" });
  });

  it("rejects invalid database and listen values", () => {
    expect(() =>
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: "https://database.example/inside",
      }),
    ).toThrow("DATABASE_URL must use the postgres or postgresql protocol");

    expect(() =>
      parsePlatformConfig({ NODE_ENV: "test", API_PORT: "invalid" }),
    ).toThrow(
      "API_PORT must be an integer between 1 and 65535",
    );
    expect(() =>
      parsePlatformConfig({
        NODE_ENV: "test",
        TELEGRAM_BOT_START_URL: "https://example.test/not-telegram",
      }),
    ).toThrow("TELEGRAM_BOT_START_URL must be a t.me bot deep-link base URL");
    expect(() =>
      parsePlatformConfig({
        NODE_ENV: "test",
        TELEGRAM_LINK_LIFETIME_SECONDS: "601",
      }),
    ).toThrow(
      "TELEGRAM_LINK_LIFETIME_SECONDS must be an integer between 60 and 600",
    );
    expect(() =>
      parsePlatformConfig({
        NODE_ENV: "test",
        OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS: "301",
      }),
    ).toThrow(
      "OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS must be an integer between 1 and 300",
    );
    expect(() =>
      parsePlatformConfig({
        NODE_ENV: "test",
        PROFILE_AVATAR_ORPHAN_GRACE_SECONDS: "3599",
      }),
    ).toThrow(
      "PROFILE_AVATAR_ORPHAN_GRACE_SECONDS must be an integer between 3600 and 2592000",
    );
    expect(() =>
      parsePlatformConfig({
        NODE_ENV: "test",
        OBJECT_STORAGE_FORCE_PATH_STYLE: "garbage",
      }),
    ).toThrow("OBJECT_STORAGE_FORCE_PATH_STYLE must be true or false");
    expect(
      parsePlatformConfig({
        NODE_ENV: "development",
        OBJECT_STORAGE_FORCE_PATH_STYLE: "false",
      }).objectStorage.forcePathStyle,
    ).toBe(false);
    expect(() =>
      parsePlatformConfig({
        NODE_ENV: "test",
        KINESCOPE_API_BASE_URL: "https://attacker.example",
      }),
    ).toThrow("KINESCOPE_API_BASE_URL must use HTTPS on a Kinescope host");
  });
});

const localKinescopeConfig = {
  apiBaseUrl: "https://api.kinescope.io",
  apiToken: "inside-local-kinescope-api-token",
  callbackPassword: "inside-local-callback-password",
  callbackUsername: "inside-local-callback",
  membershipProjectId: "inside-local-membership-project",
  playbackJwtSecret: "inside-local-kinescope-playback-secret",
  playbackJwtTtlSeconds: 60,
  providerMode: "test",
  publicProjectId: "inside-local-public-project",
  uploaderBaseUrl: "https://uploader.kinescope.io",
  webhookPassword: "inside-local-webhook-password",
  webhookUsername: "inside-local-webhook",
} as const;

describe("MCP process configuration", () => {
  it("uses an explicit local Streamable HTTP endpoint", () => {
    expect(parseMcpConfig({}, "development")).toEqual({
      host: "127.0.0.1",
      port: 3002,
      serverUrl: "http://127.0.0.1:3002/mcp",
    });
  });

  it("requires an HTTPS public endpoint in production", () => {
    expect(() => parseMcpConfig({}, "production")).toThrow(
      "MCP_HOST is required in production mode",
    );
    expect(() =>
      parseMcpConfig(
        {
          MCP_HOST: "0.0.0.0",
          MCP_PORT: "3002",
          MCP_SERVER_URL: "http://mcp.example.test/mcp",
        },
        "production",
      ),
    ).toThrow("MCP_SERVER_URL must use HTTPS in production mode");
    expect(
      parseMcpConfig(
        {
          MCP_HOST: "0.0.0.0",
          MCP_PORT: "3002",
          MCP_SERVER_URL: "https://mcp.example.test/mcp",
        },
        "production",
      ),
    ).toEqual({
      host: "0.0.0.0",
      port: 3002,
      serverUrl: "https://mcp.example.test/mcp",
    });
  });

  it("rejects invalid listen and public endpoint values", () => {
    expect(() =>
      parseMcpConfig({ MCP_PORT: "0" }, "test"),
    ).toThrow("MCP_PORT must be an integer between 1 and 65535");
    expect(() =>
      parseMcpConfig(
        { MCP_SERVER_URL: "http://127.0.0.1:3002/mcp?token=secret" },
        "test",
      ),
    ).toThrow("MCP_SERVER_URL must not contain credentials, query, or fragment");
  });
});
