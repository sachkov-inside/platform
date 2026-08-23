import { describe, expect, it } from "vitest";

import { readApiListenConfig } from "../src/config/api-listen.js";
import { readDatabaseConfig } from "../src/config/database.js";

describe("process configuration", () => {
  it("does not parse API-only values for database consumers", () => {
    expect(
      readDatabaseConfig({
        API_PORT: "invalid",
        DATABASE_URL: "postgresql://database.example/inside",
      }),
    ).toEqual({ url: "postgresql://database.example/inside" });
  });

  it("rejects an invalid API port for the API process", () => {
    expect(() => readApiListenConfig({ API_PORT: "invalid" })).toThrow(
      "API_PORT must be an integer between 1 and 65535",
    );
  });
});
