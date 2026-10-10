import { vi } from "vitest";
import type * as Vitest from "vitest";
import type * as Postgres from "pg";
import { startNotificationBroker } from "../integration/setup/broker.js";
import {
  createMigratedTestDatabase,
  createTestDatabase,
} from "../integration/setup/test-database.js";
import { createPrismaClient } from "../../src/infrastructure/prisma/index.js";

const lifecycle = vi.hoisted(() => ({
  setup: undefined as (() => Promise<void>) | undefined,
  teardown: undefined as (() => Promise<void>) | undefined,
}));
const adapters = vi.hoisted(() => ({
  pool: {
    query: vi.fn<() => Promise<void>>(),
    end: vi.fn<() => Promise<void>>(),
  },
  worker: {
    start: vi.fn<() => Promise<void>>(),
    stop: vi.fn<() => Promise<void>>(),
  },
  stand: { stop: vi.fn<() => Promise<void>>() },
  startStand: vi.fn<() => Promise<void>>(),
}));

// Capture the real suites' lifecycle without running their infrastructure scenarios.
vi.mock("vitest", async (importOriginal) => {
  const actual = await importOriginal<typeof Vitest>();
  return {
    ...actual,
    describe: (_name: string, body: () => void) => body(),
    test: () => undefined,
    beforeEach: () => undefined,
    afterEach: () => undefined,
    beforeAll: (setup: () => Promise<void>) => {
      lifecycle.setup = setup;
    },
    afterAll: (teardown: () => Promise<void>) => {
      lifecycle.teardown = teardown;
    },
  };
});
vi.mock("../integration/setup/broker.js", () => ({
  startNotificationBroker: vi.fn(),
  queueConsumers: vi.fn(),
  queueDepth: vi.fn(),
  queueLimit: vi.fn(),
}));
vi.mock("../integration/setup/test-database.js", () => ({
  createMigratedTestDatabase: vi.fn(),
  createTestDatabase: vi.fn(),
}));
vi.mock("pg", async (importOriginal) => {
  const actual = await importOriginal<typeof Postgres>();
  class Pool {
    query = adapters.pool.query;
    end = adapters.pool.end;
  }
  return { ...actual, Pool, default: { ...actual, Pool } };
});
vi.mock(
  "../../src/entrypoints/notifications-worker/assemble-notification-pipeline.js",
  () => ({ assembleNotificationPipeline: () => adapters.worker }),
);
vi.mock("../integration/setup/telegram-provider-stand.js", () => ({
  providerStand: async () => {
    await adapters.startStand();
    return adapters.stand;
  },
}));

const { beforeEach, describe, expect, test } =
  await vi.importActual<typeof Vitest>("vitest");

async function loadSuite(suite: "transport" | "acceptance") {
  if (suite === "transport")
    await import("../integration/notification-transport.test.js");
  else await import("../integration/notifications-acceptance.test.js");
  const { setup, teardown } = lifecycle;
  if (setup === undefined || teardown === undefined)
    throw new Error("Notifications suite did not register its lifecycle");
  return { setup, teardown };
}

function brokerDouble(stop = vi.fn<() => Promise<void>>().mockResolvedValue()) {
  return {
    urls: { billing: "", materials: "", notifications: "", email: "" },
    url: () => "",
    caFile: undefined,
    admin: vi.fn<() => Promise<string>>(),
    diagnostics: vi.fn<() => Promise<string>>(),
    stop,
  };
}

function databaseDouble(
  dispose = vi.fn<() => Promise<void>>().mockResolvedValue(),
) {
  const prisma = createPrismaClient(
    "postgresql://synthetic:synthetic@invalid.test/lifecycle",
  );
  vi.spyOn(prisma.account, "create").mockImplementation(
    vi.fn<typeof prisma.account.create>(),
  );
  vi.spyOn(prisma.accountPermission, "create").mockImplementation(
    vi.fn<typeof prisma.accountPermission.create>(),
  );
  vi.spyOn(prisma.product, "create").mockImplementation(
    vi.fn<typeof prisma.product.create>(),
  );
  vi.spyOn(prisma.topic, "create").mockImplementation(
    vi.fn<typeof prisma.topic.create>(),
  );
  return {
    prisma,
    url: "postgresql://synthetic:synthetic@invalid.test/lifecycle",
    run: <Result>(work: () => Promise<Result>) => work(),
    drain: () => Promise.resolve(),
    dispose,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  lifecycle.setup = undefined;
  lifecycle.teardown = undefined;
  adapters.pool.query.mockResolvedValue();
  adapters.pool.end.mockResolvedValue();
  adapters.worker.start.mockResolvedValue();
  adapters.worker.stop.mockResolvedValue();
  adapters.stand.stop.mockResolvedValue();
  adapters.startStand.mockResolvedValue();
});

describe.each(["transport", "acceptance"] as const)(
  "Notifications %s setup ownership",
  (suite) => {
    test("preserves acquisition failure before any resource exists", async () => {
      const primary = new Error("broker acquisition failed");
      vi.mocked(startNotificationBroker).mockRejectedValue(primary);
      const hooks = await loadSuite(suite);

      await expect(hooks.setup()).rejects.toBe(primary);
      await expect(hooks.teardown()).resolves.toBeUndefined();
      expect(createMigratedTestDatabase).not.toHaveBeenCalled();
    });

    test("releases the acquired broker once when database acquisition fails", async () => {
      const primary = new Error("database acquisition failed");
      const broker = brokerDouble();
      vi.mocked(startNotificationBroker).mockResolvedValue(broker);
      vi.mocked(createMigratedTestDatabase).mockRejectedValue(primary);
      const hooks = await loadSuite(suite);

      await expect(hooks.setup()).rejects.toBe(primary);
      await expect(hooks.teardown()).resolves.toBeUndefined();
      expect(broker.stop).toHaveBeenCalledTimes(1);
    });

    test("reports cleanup failure and still releases every later resource once", async () => {
      const failure = new Error("database cleanup failed");
      const broker = brokerDouble();
      const platform = databaseDouble(
        vi.fn<() => Promise<void>>().mockRejectedValue(failure),
      );
      const provider = databaseDouble();
      vi.mocked(startNotificationBroker).mockResolvedValue(broker);
      vi.mocked(createMigratedTestDatabase).mockResolvedValue(platform);
      vi.mocked(createTestDatabase).mockResolvedValue(provider);
      const hooks = await loadSuite(suite);

      await hooks.setup();
      await expect(hooks.teardown()).rejects.toMatchObject({
        errors: [failure],
      });
      expect(platform.dispose).toHaveBeenCalledTimes(1);
      expect(broker.stop).toHaveBeenCalledTimes(1);
      if (suite === "acceptance") {
        expect(adapters.worker.stop).toHaveBeenCalledTimes(1);
        expect(adapters.stand.stop).toHaveBeenCalledTimes(1);
        expect(adapters.pool.end).toHaveBeenCalledTimes(1);
        expect(provider.dispose).toHaveBeenCalledTimes(1);
      }
      await expect(hooks.teardown()).resolves.toBeUndefined();
      expect(platform.dispose).toHaveBeenCalledTimes(1);
      expect(broker.stop).toHaveBeenCalledTimes(1);
    });

    test("keeps the startup error observable when broker cleanup also fails", async () => {
      const primary = new Error("database acquisition failed");
      const cleanupFailure = new Error("broker cleanup failed");
      const broker = brokerDouble(
        vi.fn<() => Promise<void>>().mockRejectedValue(cleanupFailure),
      );
      vi.mocked(startNotificationBroker).mockResolvedValue(broker);
      vi.mocked(createMigratedTestDatabase).mockRejectedValue(primary);
      const hooks = await loadSuite(suite);

      await expect(hooks.setup()).rejects.toBe(primary);
      await expect(hooks.teardown()).rejects.toMatchObject({
        errors: [cleanupFailure],
      });
      expect(broker.stop).toHaveBeenCalledTimes(1);
    });
  },
);

describe("Notifications acceptance worker ownership", () => {
  async function arrange() {
    const broker = brokerDouble();
    const platform = databaseDouble();
    const provider = databaseDouble();
    vi.mocked(startNotificationBroker).mockResolvedValue(broker);
    vi.mocked(createMigratedTestDatabase).mockResolvedValue(platform);
    vi.mocked(createTestDatabase).mockResolvedValue(provider);
    return {
      hooks: await loadSuite("acceptance"),
      broker,
      platform,
      provider,
    };
  }

  test("closes the assembled worker when provider acquisition fails", async () => {
    const primary = new Error("provider acquisition failed");
    adapters.startStand.mockRejectedValue(primary);
    const { hooks, broker, platform, provider } = await arrange();

    await expect(hooks.setup()).rejects.toBe(primary);
    await expect(hooks.teardown()).resolves.toBeUndefined();
    expect(adapters.worker.start).not.toHaveBeenCalled();
    expect(adapters.worker.stop).toHaveBeenCalledTimes(1);
    expect(adapters.stand.stop).not.toHaveBeenCalled();
    expect(adapters.pool.end).toHaveBeenCalledTimes(1);
    expect(provider.dispose).toHaveBeenCalledTimes(1);
    expect(platform.dispose).toHaveBeenCalledTimes(1);
    expect(broker.stop).toHaveBeenCalledTimes(1);
  });

  test("preserves worker startup failure and attempts all cleanup in dependency order", async () => {
    const primary = new Error("worker startup failed");
    const workerFailure = new Error("worker cleanup failed");
    const poolFailure = new Error("pool cleanup failed");
    const closed: string[] = [];
    const { hooks, broker, platform, provider } = await arrange();
    adapters.worker.start.mockRejectedValue(primary);
    adapters.worker.stop.mockImplementation(() => {
      closed.push("worker");
      return Promise.reject(workerFailure);
    });
    adapters.stand.stop.mockImplementation(() => {
      closed.push("stand");
      return Promise.resolve();
    });
    adapters.pool.end.mockImplementation(() => {
      closed.push("pool");
      throw poolFailure;
    });
    provider.dispose.mockImplementation(() => {
      closed.push("provider database");
      return Promise.resolve();
    });
    platform.dispose.mockImplementation(() => {
      closed.push("platform database");
      return Promise.resolve();
    });
    broker.stop.mockImplementation(() => {
      closed.push("broker");
      return Promise.resolve();
    });

    await expect(hooks.setup()).rejects.toBe(primary);
    await expect(hooks.teardown()).rejects.toMatchObject({
      errors: [workerFailure, poolFailure],
    });
    expect(closed).toEqual([
      "worker",
      "stand",
      "pool",
      "provider database",
      "platform database",
      "broker",
    ]);
    await expect(hooks.teardown()).resolves.toBeUndefined();
    expect(closed).toHaveLength(6);
  });
});
