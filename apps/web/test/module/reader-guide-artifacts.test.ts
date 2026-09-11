import { afterEach, describe, expect, it, vi } from "vitest";

import { readReaderGuideArtifacts } from "@/features/guide-artifacts/api/read-reader-guide-artifacts.server";

const guideId = "72000000-0000-4000-8000-000000000101";
const artifact = {
  artifactId: "72000000-0000-4000-8000-000000000201",
  availability: "available",
  content: {
    contentType: "application/x-yaml",
    filename: "compose.production.yaml",
    kind: "file",
    size: 4096,
  },
  purpose: "Готовый Compose для проверки опубликованного релиза.",
  title: "Пример продакшен-Compose",
  updatedAt: "2026-09-01T10:00:00.000Z",
  version: 3,
};

describe("Guide artifact section reader adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads the section the backend already narrowed by access", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          artifacts: [
            artifact,
            {
              ...artifact,
              artifactId: "72000000-0000-4000-8000-000000000202",
              availability: "locked",
              content: { externalUrl: null, kind: "link" },
            },
          ],
        }),
      ),
    );

    const result = await readReaderGuideArtifacts(guideId);
    expect(result).toMatchObject({ kind: "ready" });
    expect(result.kind === "ready" ? result.artifacts : []).toHaveLength(2);
    const request = vi.mocked(fetch).mock.calls[0]?.[0];
    expect((request as Request).url).toBe(
      `https://platform-api.example.test/guides/${guideId}/artifacts`,
    );
  });

  // 503 is the expected outage. 404 is a contract inconsistency for a Guide the
  // catalog just resolved; it degrades the same way on purpose, so one section
  // never costs the reader the whole page.
  it.each([
    [
      404,
      {
        code: "artifact_not_found",
        status: 404,
        title: "Guide Artifact not found",
        type: "urn:inside:problem:artifact-not-found",
      },
    ],
    [
      503,
      {
        code: "dependency_unavailable",
        retryable: true,
        status: 503,
        title: "Dependency unavailable",
        type: "urn:inside:problem:dependency-unavailable",
      },
    ],
  ])(
    "degrades %i to an unavailable section instead of failing the Guide page",
    async (status, problem) => {
      vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json(problem, { status })),
      );

      await expect(readReaderGuideArtifacts(guideId)).resolves.toEqual({
        kind: "unavailable",
      });
    },
  );

  it("rejects a successful response outside the runtime contract", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          artifacts: [{ ...artifact, availability: "unavailable" }],
        }),
      ),
    );

    await expect(readReaderGuideArtifacts(guideId)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});
