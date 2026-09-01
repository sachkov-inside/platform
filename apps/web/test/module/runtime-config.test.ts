import { afterEach, describe, expect, it, vi } from "vitest";

import { parseWebRuntimeConfig } from "@/shared/config/index.server";
import { register } from "../../instrumentation";

describe("Web runtime configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses complete local defaults only outside production", () => {
    expect(parseWebRuntimeConfig({ NODE_ENV: "development" })).toEqual({
      mode: "development",
      backendBaseUrl: "http://127.0.0.1:3001",
      identity: {
        endpoint: "https://identity.inside.localhost:3301",
        audience: "http://127.0.0.1:3001",
        appId: "inside-web-local",
        appSecret: "inside-web-local-confidential-secret",
        cookieSecret: "inside-local-logto-cookie-secret-key",
        baseUrl: "http://127.0.0.1:3000",
      },
    });
  });

  it("parses and freezes one complete production config", () => {
    const config = parseWebRuntimeConfig(productionEnvironment());

    expect(config.mode).toBe("production");
    expect(config.backendBaseUrl).toBe("http://api:3001");
    expect(config.identity.baseUrl).toBe("https://inside.example.test");
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.identity)).toBe(true);
  });

  it("fails production closed and names the missing value", () => {
    expect(() =>
      parseWebRuntimeConfig({ NODE_ENV: "production" }),
    ).toThrow("BACKEND_BASE_URL is required in production mode");
  });

  it("rejects malformed and insecure production values", () => {
    expect(() =>
      parseWebRuntimeConfig({
        ...productionEnvironment(),
        BACKEND_BASE_URL: "file:///tmp/platform-api",
      }),
    ).toThrow("BACKEND_BASE_URL must use HTTP or HTTPS");
    expect(() =>
      parseWebRuntimeConfig({
        ...productionEnvironment(),
        WEB_BASE_URL: "http://inside.example.test",
      }),
    ).toThrow("WEB_BASE_URL must use HTTPS");
  });

  it("validates the Node runtime before the Next server becomes ready", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKEND_BASE_URL", "");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    await expect(register()).rejects.toThrow("process.exit(1)");
    expect(stderr).toHaveBeenCalledWith(
      "Web startup failed: BACKEND_BASE_URL is required in production mode\n",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});

function productionEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    BACKEND_BASE_URL: "http://api:3001/",
    LOGTO_ENDPOINT: "https://identity.example.test",
    LOGTO_AUDIENCE: "https://api.example.test",
    LOGTO_APP_ID: "inside-web",
    LOGTO_APP_SECRET: "inside-web-confidential-secret",
    LOGTO_COOKIE_SECRET: "inside-web-cookie-secret-32-characters",
    WEB_BASE_URL: "https://inside.example.test",
  };
}
