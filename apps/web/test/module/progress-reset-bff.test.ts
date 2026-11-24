import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { learningScenario as facts } from "../../../../scenarios/learning.mjs";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import { handleProgressReset as realHandleProgressReset } from "@/features/reading-progress.server";

const handleProgressReset = (request: Request) =>
  session(() => realHandleProgressReset(request));
const materialIds = facts.lessons.slice(0, 2).map((lesson) => lesson.id);
const commandId = randomUUID();

function request(
  values: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  return new Request("https://inside.example.test/api/reading-progress/reset", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(values),
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

it("rejects a cross-origin reset before the session or the backend", async () => {
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
  const response = await handleProgressReset(
    request({ materialIds, commandId }, "https://outside.test"),
  );
  expect(response.status).toBe(403);
  expect(tokenReads).not.toHaveBeenCalled();
  expect(backend).not.toHaveBeenCalled();
});

it("sends only the chapter's lessons and the command, with the session's own token", async () => {
  backend.mockResolvedValueOnce(
    Response.json({ resetCount: 2, replayed: false }),
  );
  const response = await handleProgressReset(
    request({ materialIds, commandId }),
  );
  expect(backend).toHaveBeenCalledOnce();
  const sent = backend.mock.calls[0]?.[0];
  if (sent === undefined) throw new Error("Expected backend request");
  expect(sent.method).toBe("POST");
  expect(sent.url).toBe(
    "https://platform-api.example.test/reading-activity/materials/reset",
  );
  expect(sent.headers.get("authorization")).toBe("Bearer trusted-token");
  expect(await sent.json()).toEqual({ materialIds, commandId });
  expect(await response.json()).toEqual({ kind: "reset", resetCount: 2 });
  expect(response.headers.get("cache-control")).toBe("no-store, private");
});

it("refuses a posted identity, an empty or oversized chapter without calling the backend", async () => {
  for (const values of [
    { materialIds, commandId, accountId: "untrusted" },
    { materialIds: [], commandId },
    { materialIds: Array.from({ length: 101 }, () => randomUUID()), commandId },
    { materialIds: ["not-a-uuid"], commandId },
    { materialIds },
  ])
    expect(await (await handleProgressReset(request(values))).json()).toEqual({
      kind: "invalid_input",
    });
  expect(backend).not.toHaveBeenCalled();
});

it("never claims a reset it cannot read back", async () => {
  backend
    .mockResolvedValueOnce(
      Response.json({ code: "command_conflict" }, { status: 409 }),
    )
    .mockResolvedValueOnce(Response.json({ resetCount: -1, replayed: false }))
    .mockRejectedValueOnce(new Error("lost response"));
  const answers = [];
  for (let attempt = 0; attempt < 3; attempt++)
    answers.push(
      await (
        await handleProgressReset(request({ materialIds, commandId }))
      ).json(),
    );
  expect(answers).toEqual([
    { kind: "unavailable" },
    { kind: "unavailable" },
    { kind: "unavailable" },
  ]);
});
