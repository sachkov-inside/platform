import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
}));

vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: fakes.LogtoSessionUnavailableError,
}));

import type { MutationOperation } from "@/shared/api/mutation-operation";

import { routeBrowserMutations } from "../support/mutation-operation-route";

/** Operations a guest may send: their route answers without a session, so only Origin is checked. */
const guestOperations = new Set([
  "createMaterialVideoPlaybackSessionOperation",
  "beginWaitlistIntentOperation",
]);

type AnyOperation = MutationOperation<z.ZodType, z.ZodType>;

const moduleExports = z.record(z.string(), z.unknown());
const webRoot = fileURLToPath(new URL("../..", import.meta.url));

function operationModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return operationModules(entryPath);
    return entry.name.endsWith(".operation.ts") ? [entryPath] : [];
  });
}

function isOperation(value: unknown): value is AnyOperation {
  return (
    typeof value === "object" &&
    value !== null &&
    "send" in value &&
    "path" in value &&
    "method" in value
  );
}

const operations = await Promise.all(
  operationModules(path.join(webRoot, "src")).map(async (file) => {
    const exports = moduleExports.parse(await import(file));
    return Object.entries(exports).flatMap(([name, value]) =>
      isOperation(value) ? [{ file, name, operation: value }] : [],
    );
  }),
).then((lists) => lists.flat());

async function routeModule(operationPath: string) {
  const routes = moduleExports.parse(
    await import(path.join(webRoot, "app", operationPath, "route.ts")),
  );
  return Object.fromEntries(
    Object.entries(routes).filter(
      (entry): entry is [string, (request: Request) => Promise<Response>] =>
        typeof entry[1] === "function",
    ),
  );
}

/** What a call produced: its value, or the message it rejected with. */
async function outcome(call: () => unknown): Promise<unknown> {
  try {
    return { value: await call() };
  } catch (error) {
    return { rejected: error instanceof Error ? error.message : String(error) };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockRejectedValue(new fakes.LogtoSessionUnavailableError());
});

/**
 * Every declared operation once through its browser adapter and the Route Handler of its literal
 * path: the shared boundary answers before any backend call, and the adapter maps that answer
 * through the operation's own outcome.
 */
describe("every mutation operation reaches its Route Handler", () => {
  it("finds the declared operations", () => {
    expect(operations.length).toBeGreaterThan(0);
  });

  it.each(
    operations
      .filter((entry) => !guestOperations.has(entry.name))
      .map((entry) => [entry.name, entry] as const),
  )(
    "%s refuses a missing session through its route",
    async (_name, { operation }) => {
      const { requests, statuses } = routeBrowserMutations({
        [operation.path]: await routeModule(operation.path),
      });

      // Сессия проверяется раньше тела, поэтому достаточно любого объекта.
      const result = await outcome(() => operation.send({}));

      expect(requests[0]?.method).toBe(operation.method);
      expect(statuses).toEqual([401]);
      expect(result).toEqual(
        await outcome(() =>
          operation.transportFailure({ kind: "status", status: 401 }),
        ),
      );
    },
  );

  it.each(operations.map((entry) => [entry.name, entry] as const))(
    "%s refuses another origin before the session",
    async (_name, { operation }) => {
      const { statuses } = routeBrowserMutations(
        { [operation.path]: await routeModule(operation.path) },
        "https://outside.test",
      );

      const result = await outcome(() => operation.send({}));

      expect(result).toEqual(
        await outcome(() =>
          operation.transportFailure({ kind: "status", status: 403 }),
        ),
      );
      expect(statuses).toEqual([403]);
      expect(fakes.token).not.toHaveBeenCalled();
    },
  );
});
