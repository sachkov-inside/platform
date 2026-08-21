import { describe, expect, it, vi } from "vitest";

import type { DatabaseProbe } from "../src/modules/readiness/database-probe";
import { ReadinessService } from "../src/modules/readiness/readiness.service";

describe("ReadinessService", () => {
  it("reports the selected process after PostgreSQL responds", async () => {
    const database: DatabaseProbe = {
      ping: vi.fn().mockResolvedValue(undefined),
    };
    const readiness = new ReadinessService(database);

    await expect(readiness.check("worker")).resolves.toEqual({
      process: "worker",
      status: "ok",
      database: "reachable",
    });
    expect(database.ping).toHaveBeenCalledOnce();
  });
});
