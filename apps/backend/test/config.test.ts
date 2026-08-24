import { describe, expect, it } from "vitest";

import { parsePlatformConfig } from "../src/config/platform-config.js";

describe("process configuration", () => {
  it("parses and freezes one config without mutating process.env", () => {
    const processEnvironmentBefore = { ...process.env };

    const config = parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://database.example/inside",
      API_HOST: "api.example",
      API_PORT: "4100",
    });

    expect(config).toEqual({
      mode: "test",
      database: { url: "postgresql://database.example/inside" },
      api: { host: "api.example", port: 4100 },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
    expect(Object.isFrozen(config.api)).toBe(true);
    expect(process.env).toEqual(processEnvironmentBefore);
  });

  it("uses local defaults only in explicit development or test mode", () => {
    expect(parsePlatformConfig({ NODE_ENV: "development" })).toEqual({
      mode: "development",
      database: {
        url: "postgresql://inside:inside@127.0.0.1:5432/inside",
      },
      api: { host: "127.0.0.1", port: 3001 },
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
  });
});
