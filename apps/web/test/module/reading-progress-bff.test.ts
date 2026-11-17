import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { learningScenario as facts } from "../../../../scenarios/learning.mjs";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleReadingStates as realHandleReadingStates,
  handleSetReadingState as realHandleSetReadingState,
} from "@/features/reading-progress.server";
const handleReadingStates = (request: Request) =>
  session(() => realHandleReadingStates(request));
const handleSetReadingState = (request: Request) =>
  session(() => realHandleSetReadingState(request));
const materialId = facts.lessons.find((lesson) => lesson.key === "intro")?.id;
if (materialId === undefined)
  throw new Error("Missing canonical introduction lesson");
const commandId = "20000000-0000-4000-8000-000000000001";
const state = {
  materialId,
  isRead: true,
  version: 3,
  readAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
};
function request(
  values: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  const body = JSON.stringify(values);
  return new Request("https://inside.example.test/api/reading-progress/state", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body,
  });
}
beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(facts.fixtureDate));
  session = await realBffSession();
  vi.stubGlobal("fetch", backend);
});
afterEach(() => vi.useRealTimers());

it("rejects cross-origin writes before authentication or backend calls", async () => {
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
  const response = await handleSetReadingState(
    request({ materialId }, "https://outside.test"),
  );
  expect(response.status).toBe(403);
  expect(tokenReads).not.toHaveBeenCalled();
  expect(backend).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("no-store, private");
});
it("preserves the idempotency command and authenticates independently of posted identity", async () => {
  backend.mockResolvedValueOnce(
    Response.json({ state, changed: false, replayed: true }),
  );
  const response = await handleSetReadingState(
    request({
      materialId,
      commandId,
      expectedVersion: 2,
      isRead: true,
      accountId: "untrusted",
    }),
  );
  expect(
    await expectBackendRequest(
      "PUT",
      `/reading-activity/materials/${materialId}`,
    ).json(),
  ).toEqual({ commandId, expectedVersion: 2, isRead: true });
  expect(await response.json()).toEqual({
    kind: "saved",
    state,
    replayed: true,
  });
  expect(response.headers.get("vary")).toBe("cookie");
});
it("returns current conflict state without claiming a successful write", async () => {
  backend.mockResolvedValueOnce(
    Response.json({ code: "stale_version", current: state }, { status: 409 }),
  );
  const response = await handleSetReadingState(
    request({ materialId, commandId, expectedVersion: 1, isRead: false }),
  );
  expect(await response.json()).toEqual({ kind: "conflict", current: state });
});
it("does not report success for transport failures or malformed success bodies", async () => {
  backend
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce(Response.json({ state: { isRead: true } }));
  for (let i = 0; i < 2; i++)
    expect(
      await (
        await handleSetReadingState(
          request({
            materialId,
            commandId,
            expectedVersion: 2,
            isRead: true,
          }),
        )
      ).json(),
    ).toEqual({ kind: "unavailable" });
});
it("bounds batch reads and returns private state, with an unseen update note, without public metadata", async () => {
  const listed = {
    ...state,
    updateNote: {
      whatChanged: "Переписан раздел о сборке промпта.",
      notedAt: "2026-09-08T00:00:00.000Z",
    },
    openedParts: 2,
  };
  backend.mockResolvedValueOnce(Response.json([listed]));
  const response = await handleReadingStates(
    request({ materialIds: [materialId] }),
  );
  expect(await response.json()).toEqual({ kind: "ready", states: [listed] });
  expect(
    await expectBackendRequest(
      "POST",
      "/reading-activity/materials/query",
    ).json(),
  ).toEqual({ materialIds: [materialId] });
  const body = JSON.stringify({
    materialIds: Array.from({ length: 101 }, () => materialId),
  });
  expect(
    await (
      await handleReadingStates(
        new Request("https://inside.example.test/api/reading-progress/states", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://inside.example.test",
          },
          body,
        }),
      )
    ).json(),
  ).toEqual({ kind: "invalid_input" });
  expect(backend).toHaveBeenCalledTimes(1);
});

function expectBackendRequest(method: string, path: string): Request {
  expect(backend).toHaveBeenCalledOnce();
  const request = backend.mock.calls[0]?.[0];
  if (request === undefined) throw new Error("Expected backend request");
  expect(request.method).toBe(method);
  expect(request.url).toBe(`https://platform-api.example.test${path}`);
  expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
  return request;
}
