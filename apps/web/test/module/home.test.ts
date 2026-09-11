import { afterEach, describe, expect, it, vi } from "vitest";
import { getHome } from "../../src/_pages/home/api/get-home";

const home = { pinnedSeries: null, guides: [], notes: [], playlists: [], topics: [], videos: [] };

describe("Home membership presentation", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it.each([
    { kind: "active" },
    { kind: "inactive", acquisitionUrl: "https://t.me/tribute/app?startapp=inside" },
    { kind: "notOffered" },
    { kind: "unknown" },
  ])("preserves $kind from the authoritative content response", async (membership) => {
    vi.stubEnv("BACKEND_BASE_URL", "https://api.example.test");
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...home, membership }));
    vi.stubGlobal("fetch", fetch);
    await expect(getHome("member-token")).resolves.toEqual({ kind: "ready", value: { ...home, membership } });
    expect(fetch).toHaveBeenCalledOnce();
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer member-token");
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "ftp://example.test/access"])("rejects an acquisition URL that cannot be a web destination: %s", async (acquisitionUrl) => {
    vi.stubEnv("BACKEND_BASE_URL", "https://api.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...home, membership: { kind: "inactive", acquisitionUrl } })));
    await expect(getHome()).rejects.toThrow("Home response does not match the contract");
  });
});
