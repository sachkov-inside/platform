import { vi } from "vitest";
import type * as Vitest from "vitest";

const lifecycle = vi.hoisted(() => ({
  body: undefined as (() => Promise<void>) | undefined,
  cleanup: [] as (() => unknown)[],
}));
const resources = vi.hoisted(() => ({
  database: {
    url: "postgresql://synthetic:synthetic@invalid.test/archive",
    dispose: vi.fn(),
    prisma: {
      account: { findFirstOrThrow: vi.fn() },
      product: { findUniqueOrThrow: vi.fn() },
      productTask: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    },
  },
  identity: {
    issuer: "https://archive.test/oidc",
    audience: "https://archive.test/api",
    jwksUrl: "https://archive.test/jwks",
    sign: vi.fn(),
    close: vi.fn(),
  },
  app: {
    init: vi.fn(),
    close: vi.fn(),
    getHttpAdapter: () => ({ getInstance: () => ({}) }),
    get: () => ({}),
  },
  server: { ready: vi.fn(), inject: vi.fn() },
  mcp: { listen: vi.fn(), close: vi.fn() },
  client: { connect: vi.fn(), close: vi.fn() },
  acquireIdentity: vi.fn(),
  acquireApp: vi.fn(),
}));
vi.mock("vitest", async (original) => ({
  ...(await original<typeof Vitest>()),
  test: (_name: string, body: () => Promise<void>) => {
    lifecycle.body = body;
  },
  onTestFinished: (cleanup: () => unknown) => {
    lifecycle.cleanup.push(cleanup);
  },
}));
vi.mock("../support/fixed-clock.js", () => ({
  registerFixedClock: () => undefined,
}));
vi.mock("../integration/setup/test-database.js", () => ({
  createMigratedTestDatabase: () => Promise.resolve(resources.database),
}));
vi.mock("../integration/setup/test-identity-issuer.js", () => ({
  startTestIdentityIssuer: resources.acquireIdentity,
}));
vi.mock("../../src/entrypoints/api/create-api-application.js", () => ({
  createApiApplication: resources.acquireApp,
}));
vi.mock("../support/declared-api.js", () => ({
  declaredServer: () => resources.server,
}));
vi.mock("../../src/entrypoints/mcp/mcp-http-server.js", () => ({
  createMcpHttpServer: () => resources.mcp,
}));
vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    connect = resources.client.connect;
    close = resources.client.close;
  },
  StreamableHTTPClientTransport: vi.fn(),
}));
vi.mock("../integration/setup/scoped-products.js", () => ({
  createScopedProductsWorld: () =>
    Promise.resolve({
      grantProduct: () => Promise.resolve({}),
      productA: { productId: "product-a", taskCode: "task-a" },
      freeProduct: { productId: "free", taskCode: "task-free" },
    }),
}));

const { beforeAll, beforeEach, expect, test } =
  await vi.importActual<typeof Vitest>("vitest");
beforeAll(async () => {
  await import("../integration/archived-product-task-access.test.js");
});
beforeEach(() => {
  vi.resetAllMocks();
  lifecycle.cleanup = [];
  resources.acquireIdentity.mockResolvedValue(resources.identity);
  resources.acquireApp.mockResolvedValue(resources.app);
  resources.server.inject.mockResolvedValue({ statusCode: 201 });
  resources.database.prisma.account.findFirstOrThrow.mockResolvedValue({
    id: "holder",
  });
  resources.database.prisma.productTask.findUniqueOrThrow.mockResolvedValue({
    sourceId: "task-source",
  });
  resources.mcp.listen.mockResolvedValue(new URL("http://127.0.0.1:1234/mcp"));
});

// Replay the real test's native registrations independently, as Vitest does even after a hook fails.
async function runCleanup() {
  const results = [];
  for (const cleanup of [...lifecycle.cleanup].reverse()) {
    try {
      await cleanup();
      results.push({ status: "fulfilled" });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }
  return results;
}
async function runBody() {
  if (lifecycle.body === undefined)
    throw new Error("Archive test did not register");
  await lifecycle.body();
}

test("identity setup failure disposes the already acquired database", async () => {
  const original = new Error("identity setup failed");
  resources.acquireIdentity.mockRejectedValue(original);
  await expect(runBody()).rejects.toBe(original);
  expect(await runCleanup()).toEqual([{ status: "fulfilled" }]);
  expect(resources.database.dispose).toHaveBeenCalledOnce();
});
test("application setup failure closes identity and database", async () => {
  const original = new Error("application setup failed");
  resources.acquireApp.mockRejectedValue(original);
  await expect(runBody()).rejects.toBe(original);
  expect(await runCleanup()).toHaveLength(2);
  expect(resources.identity.close).toHaveBeenCalledOnce();
  expect(resources.database.dispose).toHaveBeenCalledOnce();
});
test("client startup and cleanup failures preserve both errors and close every independent resource", async () => {
  const original = new Error("client startup failed");
  const cleanupFailure = new Error("client close failed");
  resources.client.connect.mockRejectedValue(original);
  resources.client.close.mockRejectedValue(cleanupFailure);
  await expect(runBody()).rejects.toBe(original);
  expect(await runCleanup()).toEqual([
    { status: "rejected", reason: cleanupFailure },
    { status: "fulfilled" },
    { status: "fulfilled" },
    { status: "fulfilled" },
    { status: "fulfilled" },
  ]);
  for (const dispose of [
    resources.client.close,
    resources.mcp.close,
    resources.app.close,
    resources.identity.close,
    resources.database.dispose,
  ])
    expect(dispose).toHaveBeenCalledOnce();
});
