import { afterEach, describe, expect, it, vi } from "vitest";
import { getHome } from "../../src/_pages/home/api/get-home";

const home = { pinnedSeries: null, guides: [], notes: [], playlists: [], topics: [], videos: [] };

describe("Home membership presentation", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  // Главная получает от сервера только состояние подписки: призыв к покупке ведёт на внутреннюю
  // витрину, поэтому внешнего адреса покупки в контракте нет.
  it.each([
    { kind: "active" },
    { kind: "inactive" },
    { kind: "notOffered" },
    { kind: "unknown" },
  ])("keeps $kind from the authoritative content response", async (membership) => {
    vi.stubEnv("BACKEND_BASE_URL", "https://api.example.test");
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...home, membership }));
    vi.stubGlobal("fetch", fetch);
    await expect(getHome("member-token")).resolves.toEqual({ kind: "ready", value: { ...home, membership: { kind: membership.kind } } });
    expect(fetch).toHaveBeenCalledOnce();
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer member-token");
  });

  // Внешний адрес покупки убран из контракта. Ответ, который снова его несёт, — дрейф контракта,
  // а не данные для главной: адаптер отвергает его, а не передаёт дальше.
  it("rejects a Home response that carries an external acquisition address", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://api.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...home, membership: { kind: "inactive", acquisitionUrl: "https://t.me/tribute" } })));
    await expect(getHome()).rejects.toMatchObject({ code: "invalid-response" });
  });
});
