import { afterEach, describe, expect, it, vi } from "vitest";
import { getHome } from "../../src/_pages/home/api/get-home";

const home = { pinnedSeries: null, guides: [], notes: [], playlists: [], topics: [], videos: [] };

describe("Home membership presentation", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  // Главная показывает состояние подписки, но никогда не показывает внешний адрес покупки:
  // призыв ведёт на внутреннюю витрину, поэтому адрес до презентационной модели не доходит.
  it.each([
    { kind: "active" },
    { kind: "inactive", acquisitionUrl: "https://t.me/tribute/app?startapp=inside" },
    { kind: "notOffered" },
    { kind: "unknown" },
  ])("keeps $kind from the authoritative content response without its acquisition address", async (membership) => {
    vi.stubEnv("BACKEND_BASE_URL", "https://api.example.test");
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...home, membership }));
    vi.stubGlobal("fetch", fetch);
    await expect(getHome("member-token")).resolves.toEqual({ kind: "ready", value: { ...home, membership: { kind: membership.kind } } });
    expect(fetch).toHaveBeenCalledOnce();
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer member-token");
  });

  // Адрес покупки до читателя не доходит, поэтому его вид не может сломать главную: призыв ведёт
  // на внутреннюю витрину, и негодный внешний адрес остаётся просто неиспользованным полем.
  it.each(["javascript:alert(1)", "data:text/html,hello", "ftp://example.test/access"])("keeps the Home usable when the contract carries an acquisition URL that is no web destination: %s", async (acquisitionUrl) => {
    vi.stubEnv("BACKEND_BASE_URL", "https://api.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...home, membership: { kind: "inactive", acquisitionUrl } })));
    await expect(getHome()).resolves.toEqual({ kind: "ready", value: { ...home, membership: { kind: "inactive" } } });
  });
});
