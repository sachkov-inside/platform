import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({ token: vi.fn(), states: vi.fn(), save: vi.fn() }));
vi.mock("@/shared/api/backend/index.server", () => ({ requestReadingStates: fakes.states, requestSetReadingState: fakes.save }));
vi.mock("@/shared/auth/platform-access-token.server", () => ({ getPlatformAccessToken: fakes.token, LogtoSessionUnavailableError: class extends Error {} }));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({ readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }) }));
vi.mock("@/shared/auth/index.server", async () => { const handlers = await import("@/shared/auth/authenticated-mutation-handler.server"); return { handleAuthenticatedMutation: handlers.handleAuthenticatedMutation }; });
import { handleReadingStates, handleSetReadingState } from "@/features/reading-progress.server";
const materialId = "10000000-0000-4000-8000-000000000001";
const commandId = "20000000-0000-4000-8000-000000000001";
const state = { materialId, isRead: true, version: 3, readAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z" };
function request(values: Record<string, string>, origin = "https://inside.example.test") {
 const body = new FormData(); for (const [key, value] of Object.entries(values)) body.set(key, value);
 return new Request("https://inside.example.test/api/reading-progress/state", { method: "POST", headers: { origin }, body });
}
beforeEach(() => { vi.clearAllMocks(); fakes.token.mockResolvedValue("trusted-token"); });
it("rejects cross-origin writes before authentication or backend calls", async () => {
 const response = await handleSetReadingState(request({ materialId }, "https://outside.test"));
 expect(response.status).toBe(403); expect(fakes.token).not.toHaveBeenCalled(); expect(fakes.save).not.toHaveBeenCalled();
 expect(response.headers.get("cache-control")).toBe("no-store, private");
});
it("preserves the idempotency command and authenticates independently of posted identity", async () => {
 fakes.save.mockResolvedValue({ ok: true, body: { state, changed: false, replayed: true }, response: new Response() });
 const response = await handleSetReadingState(request({ materialId, commandId, expectedVersion: "2", isRead: "true", accountId: "untrusted" }));
 expect(fakes.save).toHaveBeenCalledWith({ materialId, commandId, expectedVersion: 2, isRead: true }, "trusted-token");
 expect(await response.json()).toEqual({ kind: "saved", state, replayed: true });
 expect(response.headers.get("vary")).toBe("cookie");
});
it("returns current conflict state without claiming a successful write", async () => {
 fakes.save.mockResolvedValue({ ok: false, problem: { code: "stale_version", current: state }, response: new Response(null, { status: 409 }) });
 const response = await handleSetReadingState(request({ materialId, commandId, expectedVersion: "1", isRead: "false" }));
 expect(await response.json()).toEqual({ kind: "conflict", current: state });
});
it("does not report success for transport failures or malformed success bodies", async () => {
 fakes.save.mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({ ok: true, body: { state: { isRead: true } }, response: new Response() });
 for (let i = 0; i < 2; i++) expect(await (await handleSetReadingState(request({ materialId, commandId, expectedVersion: "2", isRead: "true" }))).json()).toEqual({ kind: "unavailable" });
});
it("bounds batch reads and returns private state without public metadata", async () => {
 fakes.states.mockResolvedValue({ ok: true, body: [state], response: new Response() });
 const response = await handleReadingStates(request({ materialId }));
 expect(await response.json()).toEqual({ kind: "ready", states: [state] });
 expect(fakes.states).toHaveBeenCalledWith([materialId], "trusted-token");
 const body = new FormData(); for (let i = 0; i < 101; i++) body.append("materialId", materialId);
 expect(await (await handleReadingStates(new Request("https://inside.example.test/api/reading-progress/states", { method: "POST", headers: { origin: "https://inside.example.test" }, body }))).json()).toEqual({ kind: "invalid_input" });
 expect(fakes.states).toHaveBeenCalledTimes(1);
});
