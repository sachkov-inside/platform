import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestRecordLessonOpenedParts: fakes.save,
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.token,
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));
vi.mock("@/shared/auth/index.server", async () => {
  const handlers =
    await import("@/shared/auth/authenticated-mutation-handler.server");
  return {
    handleMutationOperation: handlers.handleMutationOperation,
  };
});
import { handleOpenedParts } from "@/features/reading-progress.server";

const materialId = "10000000-0000-4000-8000-000000000001";

function request(
  values: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  return new Request(
    "https://inside.example.test/api/reading-progress/opened-parts",
    {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(values),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

it("rejects a cross-origin write before the session or the backend", async () => {
  const response = await handleOpenedParts(
    request({ materialId, openedParts: 2 }, "https://outside.test"),
  );
  expect(response.status).toBe(403);
  expect(fakes.token).not.toHaveBeenCalled();
  expect(fakes.save).not.toHaveBeenCalled();
});

it("sends only the lesson and the count, with the session's own token", async () => {
  fakes.save.mockResolvedValue({
    ok: true,
    body: { openedParts: 3 },
    response: new Response(),
  });
  const response = await handleOpenedParts(
    request({ materialId, openedParts: 2 }),
  );
  expect(fakes.save).toHaveBeenCalledWith(
    { materialId, openedParts: 2 },
    "trusted-token",
  );
  expect(await response.json()).toEqual({ kind: "saved", openedParts: 3 });
  expect(response.headers.get("cache-control")).toBe("no-store, private");
});

it("refuses a posted identity or a count outside 1..1000 without calling the backend", async () => {
  for (const values of [
    { materialId, openedParts: 2, accountId: "untrusted" },
    { materialId, openedParts: 0 },
    { materialId, openedParts: 1001 },
    { materialId, openedParts: 1.5 },
    { materialId: "not-a-uuid", openedParts: 2 },
  ])
    expect(await (await handleOpenedParts(request(values))).json()).toEqual({
      kind: "invalid_input",
    });
  expect(fakes.save).not.toHaveBeenCalled();
});

it("reports a denied lesson and never claims a save it cannot read back", async () => {
  fakes.save
    .mockResolvedValueOnce({
      ok: false,
      problem: { code: "access_denied" },
      response: new Response(null, { status: 403 }),
    })
    .mockResolvedValueOnce({
      ok: true,
      body: { openedParts: 0 },
      response: new Response(),
    })
    .mockRejectedValueOnce(new Error("lost response"));
  const answers = [];
  for (let attempt = 0; attempt < 3; attempt++)
    answers.push(
      await (
        await handleOpenedParts(request({ materialId, openedParts: 2 }))
      ).json(),
    );
  expect(answers).toEqual([
    { kind: "denied" },
    { kind: "unavailable" },
    { kind: "unavailable" },
  ]);
});
