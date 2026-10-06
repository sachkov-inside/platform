import { expect, test, vi } from "vitest";

import setup from "../integration/setup/postgres.global.js";

vi.mock("@testcontainers/postgresql", () => ({
  PostgreSqlContainer: class {
    start() {
      throw new Error("A child project must not start PostgreSQL");
    }
  },
}));

test("child projects do not start PostgreSQL", async () => {
  await expect(
    setup({ isRootProject: () => false, provide: vi.fn() }),
  ).resolves.toBeUndefined();
});
