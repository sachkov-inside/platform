import { describe, expect, it, vi } from "vitest";

import type { DatabaseProbe } from "../src/modules/readiness/database-probe.js";
import { ReadinessService } from "../src/modules/readiness/readiness.service.js";

describe("ReadinessService", () => {
  it("reports the selected process after PostgreSQL responds", async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const database: DatabaseProbe = {
      ping,
    };
    const readiness = new ReadinessService(database);

    await expect(readiness.check("worker")).resolves.toEqual({
      process: "worker",
      status: "ok",
      database: "reachable",
    });
    expect(ping).toHaveBeenCalledOnce();
  });
});
