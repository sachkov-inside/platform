import { afterEach, describe, expect, it, vi } from "vitest";

import { getGuestMaterial } from "@/_pages/material-reader/api/get-material-reader";

const projection = {
  materialId: "72000000-0000-4000-8000-000000000020",
  contentVersion: 3,
  slug: "lesson",
  title: "Урок",
  summary: "О чём урок.",
  difficulty: null,
  outcomes: [],
  access: "membership",
  cover: null,
  publishedAt: "2026-08-25T05:00:00.000Z",
  primaryVideoId: null,
  topic: { id: "72000000-0000-4000-8000-000000000002", name: "Platform", slug: "platform" },
  format: { id: "guide", name: "Гайд", slug: "guide" },
  tags: [],
  seriesMemberships: [],
} as const;
const body = { schemaVersion: 1, blocks: [{ kind: "paragraph", content: [{ kind: "text", text: "Тело урока.", marks: [] }] }] } as const;

function backendAnswers(answer: unknown, status = 200) {
  vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
  const fetchBackend = vi.fn().mockResolvedValue(Response.json(answer, { status }));
  vi.stubGlobal("fetch", fetchBackend);
  return fetchBackend;
}

/** Общий кеш держит только то, что backend отдаёт любому (ADR 0027). */
describe("guest Material read kept in the shared cache", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads without a token and keeps a body the backend marked public", async () => {
    const fetchBackend = backendAnswers({ kind: "available", cacheScope: "public", projection: { ...projection, access: "free" }, body, primaryVideo: null });

    const result = await getGuestMaterial("lesson");

    expect(result.kind).toBe("available");
    const [input, init] = fetchBackend.mock.calls[0] as [Request | string, RequestInit | undefined];
    const headers = input instanceof Request ? input.headers : new Headers(init?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("drops the purchase offer of a locked Material: offers belong to the personal part", async () => {
    backendAnswers({ kind: "teaser", cacheScope: "private-no-store", projection, access: { availability: "locked", subscriptionOffered: true } });

    const result = await getGuestMaterial("lesson");

    expect(result.kind).toBe("teaser");
    expect(result).not.toHaveProperty("subscriptionOffered");
  });

  it("never keeps a body the backend did not mark public", async () => {
    backendAnswers({ kind: "available", cacheScope: "private-no-store", projection, body, primaryVideo: null });

    const result = await getGuestMaterial("lesson");

    expect(result.kind).toBe("teaser");
    expect(result).not.toHaveProperty("body");
  });

  it("passes a missing Material on so that the cache can give it a short life", async () => {
    backendAnswers({ type: "urn:inside:problem:material-not-found", title: "Material not found", status: 404, code: "material_not_found" }, 404);

    await expect(getGuestMaterial("lesson")).resolves.toEqual({ kind: "not-found" });
  });
});
