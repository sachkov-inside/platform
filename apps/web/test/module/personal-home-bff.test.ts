import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({ token: vi.fn(), open: vi.fn(), home: vi.fn() }));
vi.mock("@/shared/api/backend/index.server", () => ({ requestRecordMaterialOpen: fakes.open, requestContinueMaterials: fakes.home }));
vi.mock("@/shared/auth/platform-access-token.server", () => ({ getPlatformAccessToken: fakes.token, LogtoSessionUnavailableError: class extends Error {} }));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({ readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }) }));
vi.mock("@/shared/auth/index.server", async () => ({ handleAuthenticatedMutation: (await import("@/shared/auth/authenticated-mutation-handler.server")).handleAuthenticatedMutation }));
import { handleMaterialOpen } from "@/features/reading-progress.server";
import { handlePersonalHome } from "@/_pages/home.server";
const materialId = "10000000-0000-4000-8000-000000000001";
const commandId = "20000000-0000-4000-8000-000000000001";
function request(input: Record<string, string>, origin = "https://inside.example.test") {
 const body = new FormData(); for (const [key, value] of Object.entries(input)) body.set(key, value);
 return new Request("https://inside.example.test/api/reading-progress/open", { method: "POST", headers: { origin }, body });
}
beforeEach(() => { vi.clearAllMocks(); fakes.token.mockResolvedValue("trusted-token"); });
it("authenticates visible-open commands, preserves replay and keeps responses private", async () => {
 const saved = { openedAt: "2026-09-07T00:00:00.000Z", replayed: true };
 fakes.open.mockResolvedValue({ ok: true, body: saved, response: new Response() });
 const response = await handleMaterialOpen(request({ materialId, commandId, contentVersion: "4" }));
 expect(await response.json()).toEqual({ kind: "saved", ...saved });
 expect(fakes.open).toHaveBeenCalledWith({ materialId, commandId, contentVersion: 4 }, "trusted-token");
 expect(response.headers.get("cache-control")).toBe("no-store, private");
});
it("rejects cross-origin and user-supplied Account before sending an open", async () => {
 expect((await handleMaterialOpen(request({}, "https://outside.test"))).status).toBe(403);
 expect(await (await handleMaterialOpen(request({ materialId, commandId, contentVersion: "4", accountId: materialId }))).json()).toEqual({ kind: "invalid_input" });
 expect(fakes.open).not.toHaveBeenCalled();
});
it("does not confirm unavailable, stale-version or malformed success", async () => {
 fakes.open.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 409 }) }).mockResolvedValueOnce({ ok: true, body: {}, response: new Response() }).mockRejectedValueOnce(new Error("lost"));
 for (const kind of ["conflict", "unavailable", "unavailable"]) expect(await (await handleMaterialOpen(request({ materialId, commandId, contentVersion: "4" }))).json()).toEqual({ kind });
});
it("serves a private empty Home and limits failure to its personal layer", async () => {
 fakes.home.mockResolvedValueOnce({ ok: true, body: [], response: new Response() }).mockResolvedValueOnce({ ok: true, body: [{ material: { availability: "locked" } }], response: new Response() }).mockRejectedValueOnce(new Error("offline"));
 const response = await handlePersonalHome(request({ accountId: "untrusted" }));
 expect(await response.json()).toEqual({ kind: "ready", items: [] }); expect(fakes.home).toHaveBeenCalledWith("trusted-token");
 expect(response.headers.get("cache-control")).toBe("no-store, private");
 for (let index = 0; index < 2; index++) expect(await (await handlePersonalHome(request({}))).json()).toEqual({ kind: "unavailable" });
});
