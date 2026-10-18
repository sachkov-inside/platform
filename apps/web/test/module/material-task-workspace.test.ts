import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  read: vi.fn(),
  history: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));
vi.mock("@/shared/auth/optional-platform-access-token.server", () => ({
  getOptionalPlatformAccessToken: fakes.token,
}));
vi.mock("@/shared/api/backend/index.server", async () => ({
  ...(await vi.importActual("@/shared/api/backend/index.server")),
  requestMaterialTaskPage: fakes.read,
}));
vi.mock(
  "@/features/product-task-submission/api/load-product-task.server",
  () => ({ prefetchOwnTaskSubmissions: fakes.history }),
);
import { MaterialTaskWorkspace } from "@/features/product-task-submission/ui/material-task-workspace.server";
const connection = Promise.resolve({
  url: "https://inside.test/mcp/learning",
  setupUrl: "https://inside.test/setup",
  prompt: "Connect MCP",
});
beforeEach(() => {
  vi.clearAllMocks();
});
it("keeps an optional workspace local when identity SDK/network fails, without reading personal history", async () => {
  fakes.token.mockRejectedValueOnce(
    new TypeError("Identity provider unreachable"),
  );
  await expect(
    MaterialTaskWorkspace({
      materialId: "lesson",
      returnTo: "/materials/lesson",
      conflictingAnchorIds: [],
      connection,
    }),
  ).resolves.toBeDefined();
  expect(fakes.read).not.toHaveBeenCalled();
  expect(fakes.history).not.toHaveBeenCalled();
});
