import type { INestApplicationContext } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";

import { loadPlatformConfig } from "../src/config/load-platform-config.js";
import { createMcpApplication } from "../src/entrypoints/create-mcp-application.js";
import { OperationalReadiness } from "../src/infrastructure/operational-readiness.js";

describe("MCP runtime smoke", () => {
  let application: INestApplicationContext | undefined;

  afterEach(async () => {
    await application?.close();
  });

  it("boots the MCP composition and reaches shared PostgreSQL", async () => {
    application = await createMcpApplication(loadPlatformConfig(), {
      logger: false,
    });
    const readiness = application.get(OperationalReadiness);

    await expect(readiness.check("mcp")).resolves.toEqual({
      process: "mcp",
      status: "ok",
      database: "reachable",
    });

    await application.close();
    application = undefined;

    await expect(readiness.check("mcp")).rejects.toThrow("destroyed");
  });
});
