import "server-only";

import { z } from "zod";

const localDefaults = {
  BACKEND_BASE_URL: "http://127.0.0.1:3001",
  LOGTO_ENDPOINT: "https://identity.inside.localhost:3301",
  LOGTO_AUDIENCE: "http://127.0.0.1:3001",
  LOGTO_APP_ID: "inside-web-local",
  LOGTO_APP_SECRET: "inside-web-local-confidential-secret",
  LOGTO_COOKIE_SECRET: "inside-local-logto-cookie-secret-key",
  WEB_BASE_URL: "http://127.0.0.1:3000",
} as const;

const runtimeModeSchema = z.enum(["development", "test", "production"]);
const identitySchema = z
  .object({
    endpoint: httpUrlSchema("LOGTO_ENDPOINT").refine(
      (value) => {
        const url = new URL(value);
        return url.protocol === "https:" || isLoopbackHttpUrl(url);
      },
      { message: "LOGTO_ENDPOINT must use HTTPS" },
    ),
    audience: httpUrlSchema("LOGTO_AUDIENCE"),
    appId: z.string().trim().min(1, {
      message: "LOGTO_APP_ID must not be empty",
    }),
    appSecret: z.string().min(16, {
      message: "LOGTO_APP_SECRET must contain at least 16 characters",
    }),
    cookieSecret: z.string().min(32, {
      message: "LOGTO_COOKIE_SECRET must contain at least 32 characters",
    }),
    baseUrl: httpUrlSchema("WEB_BASE_URL"),
  })
  .readonly();
const webRuntimeConfigSchema = z
  .object({
    mode: runtimeModeSchema,
    backendBaseUrl: httpUrlSchema("BACKEND_BASE_URL").transform((value) =>
      value.replace(/\/$/u, ""),
    ),
    identity: identitySchema,
  })
  .readonly();

export type WebRuntimeMode = z.infer<typeof runtimeModeSchema>;
export type WebRuntimeConfig = z.infer<typeof webRuntimeConfigSchema>;

export function parseWebRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): WebRuntimeConfig {
  const mode = parseMode(environment.NODE_ENV);
  const config = webRuntimeConfigSchema.safeParse({
    mode,
    backendBaseUrl: readValue(environment, "BACKEND_BASE_URL", mode),
    identity: {
      endpoint: readValue(environment, "LOGTO_ENDPOINT", mode),
      audience: readValue(environment, "LOGTO_AUDIENCE", mode),
      appId: readValue(environment, "LOGTO_APP_ID", mode),
      appSecret: readValue(environment, "LOGTO_APP_SECRET", mode),
      cookieSecret: readValue(environment, "LOGTO_COOKIE_SECRET", mode),
      baseUrl: readValue(environment, "WEB_BASE_URL", mode),
    },
  });

  if (!config.success) {
    throw new Error(
      config.error.issues[0]?.message ?? "Web runtime configuration is invalid",
    );
  }
  const baseUrl = new URL(config.data.identity.baseUrl);
  if (
    mode === "production" &&
    baseUrl.protocol !== "https:" &&
    !isLoopbackHttpUrl(baseUrl)
  ) {
    throw new Error("WEB_BASE_URL must use HTTPS");
  }

  return config.data;
}

export function readWebRuntimeConfig(): WebRuntimeConfig {
  return parseWebRuntimeConfig(process.env);
}

export function validateWebRuntimeConfigOrExit(): void {
  try {
    readWebRuntimeConfig();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Web runtime configuration is invalid";
    process.stderr.write(`Web startup failed: ${message}\n`);
    process.exit(1);
  }
}

function parseMode(value: string | undefined): WebRuntimeMode {
  const mode = runtimeModeSchema.safeParse(value ?? "production");
  if (!mode.success) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  return mode.data;
}

function readValue(
  environment: NodeJS.ProcessEnv,
  name: keyof typeof localDefaults,
  mode: WebRuntimeMode,
): string {
  const value = environment[name]?.trim();
  if (value !== undefined && value.length > 0) {
    return value;
  }
  if (mode !== "production") {
    return localDefaults[name];
  }
  throw new Error(`${name} is required in production mode`);
}

function httpUrlSchema(name: string) {
  return z
    .url({ message: `${name} must be an absolute URL` })
    .transform((value) => ({ url: new URL(value), value }))
    .superRefine(({ url }, context) => {
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        context.addIssue({
          code: "custom",
          message: `${name} must use HTTP or HTTPS`,
        });
      }
    })
    .transform(({ value }) => value);
}

function isLoopbackHttpUrl(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "localhost")
  );
}
