import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MaterialTaskWorkspace } from "@/features/product-task-submission/ui/material-task-workspace.server";
import { realBffSession } from "../support/real-bff-session";
import {
  interceptIdentityOutage,
  expectIdentityOutage,
} from "../support/identity-http";

let scope: Awaited<ReturnType<typeof realBffSession>>;
const connection = Promise.resolve({
  url: "https://inside.test/mcp/learning",
  setupUrl: "https://inside.test/setup",
  prompt: "Connect MCP",
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession({ refreshToken: "failed-workspace-identity" });
});
afterEach(() => vi.useRealTimers());
it("keeps an optional workspace local when identity SDK/network fails, without reading personal history", async () => {
  const identity = interceptIdentityOutage();
  const result = await scope(() =>
    MaterialTaskWorkspace({
      materialId: "lesson",
      returnTo: "/materials/lesson",
      conflictingAnchorIds: [],
      connection,
    }),
  );
  expect(result).toBeDefined();
  const html = renderToStaticMarkup(result);
  expect(html).toContain('role="status"');
  expect(html).toContain(
    "Практика сейчас не загрузилась. Обнови страницу, чтобы повторить.",
  );
  expect(html).not.toContain("private identity provider detail");
  expectIdentityOutage(identity);
});
