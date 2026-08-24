import type { INestApplicationContext } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";

import { loadPlatformConfig } from "../src/config/load-platform-config.js";
import { createRuntimeApplication } from "../src/entrypoints/create-runtime-application.js";
import { OperationalReadiness } from "../src/infrastructure/operational-readiness.js";

describe("MCP and worker runtime smoke", () => {
  let application: INestApplicationContext | undefined;

  afterEach(async () => {
    await application?.close();
  });

  it.each(["mcp", "worker"] as const)(
    "boots the %s composition and reaches shared PostgreSQL",
    async (processName) => {
      application = await createRuntimeApplication(loadPlatformConfig(), {
        logger: false,
      });
      const readiness = application.get(OperationalReadiness);

      await expect(readiness.check(processName)).resolves.toEqual({
        process: processName,
        status: "ok",
        database: "reachable",
      });

      await application.close();
      application = undefined;

      await expect(readiness.check(processName)).rejects.toThrow("destroyed");
    },
  );
});
