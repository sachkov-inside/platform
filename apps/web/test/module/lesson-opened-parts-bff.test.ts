import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { learningScenario as facts } from "../../../../scenarios/learning.mjs";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import { handleOpenedParts as realHandleOpenedParts } from "@/features/reading-progress.server";

const handleOpenedParts = (request: Request) =>
  session(() => realHandleOpenedParts(request));
const materialId = facts.lessons.find((lesson) => lesson.key === "intro")?.id;
if (materialId === undefined)
  throw new Error("Missing canonical introduction lesson");

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

beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(facts.fixtureDate));
  session = await realBffSession();
  vi.stubGlobal("fetch", backend);
});

afterEach(() => vi.useRealTimers());

it("rejects a cross-origin write before the session or the backend", async () => {
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
  const response = await handleOpenedParts(
    request({ materialId, openedParts: 2 }, "https://outside.test"),
  );
  expect(response.status).toBe(403);
  expect(tokenReads).not.toHaveBeenCalled();
  expect(backend).not.toHaveBeenCalled();
});

it("sends only the lesson and the count, with the session's own token", async () => {
  backend.mockResolvedValueOnce(Response.json({ openedParts: 3 }));
  const response = await handleOpenedParts(
    request({ materialId, openedParts: 2 }),
  );
  expect(
    await expectBackendRequest(
      "PUT",
      `/reading-activity/materials/${materialId}/opened-parts`,
    ).json(),
  ).toEqual({ openedParts: 2 });
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
  expect(backend).not.toHaveBeenCalled();
});

it("reports a denied lesson and never claims a save it cannot read back", async () => {
  backend
    .mockResolvedValueOnce(
      Response.json({ code: "access_denied" }, { status: 403 }),
    )
    .mockResolvedValueOnce(Response.json({ openedParts: 0 }))
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

function expectBackendRequest(method: string, path: string): Request {
  expect(backend).toHaveBeenCalledOnce();
  const request = backend.mock.calls[0]?.[0];
  if (request === undefined) throw new Error("Expected backend request");
  expect(request.method).toBe(method);
  expect(request.url).toBe(`https://platform-api.example.test${path}`);
  expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
  return request;
}
