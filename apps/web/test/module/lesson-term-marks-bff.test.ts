import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  marks: vi.fn(),
  set: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestGlossaryTermMarks: fakes.marks,
  requestSetGlossaryTermMark: fakes.set,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: fakes.LogtoSessionUnavailableError,
}));

import {
  handleSetTermMark,
  handleTermMarks,
} from "@/features/lesson-term-deck.server";

const mark = {
  termId: "bounded-context",
  mark: "review",
  markedAt: "2026-11-13T09:00:00.000Z",
};

function request(
  path: string,
  method: string,
  values: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  return new Request(`https://inside.example.test${path}`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(values),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

it("rejects a cross-origin mark before authentication or backend calls", async () => {
  const response = await handleSetTermMark(
    request(
      "/api/glossary/marks/state",
      "PUT",
      { termId: "bounded-context", mark: "known" },
      "https://outside.test",
    ),
  );
  expect(response.status).toBe(403);
  expect(fakes.token).not.toHaveBeenCalled();
  expect(fakes.set).not.toHaveBeenCalled();
});

it("saves a mark for the session's Account, never a posted one", async () => {
  fakes.set.mockResolvedValue({
    ok: true,
    body: mark,
    response: new Response(),
  });
  const response = await handleSetTermMark(
    request("/api/glossary/marks/state", "PUT", {
      termId: "bounded-context",
      mark: "review",
      accountId: "untrusted",
    }),
  );
  expect(fakes.set).toHaveBeenCalledWith(
    { termId: "bounded-context", mark: "review" },
    "trusted-token",
  );
  expect(await response.json()).toEqual({ kind: "ready", mark });
});

it("refuses an unknown mark value without a backend call", async () => {
  const response = await handleSetTermMark(
    request("/api/glossary/marks/state", "PUT", {
      termId: "bounded-context",
      mark: "forgotten",
    }),
  );
  expect(await response.json()).toEqual({ kind: "invalid_input" });
  expect(fakes.set).not.toHaveBeenCalled();
});

it("reads the deck's marks and reports a failed backend as unavailable", async () => {
  fakes.marks.mockResolvedValueOnce({
    ok: true,
    body: { marks: [mark] },
    response: new Response(),
  });
  const ready = await handleTermMarks(
    request("/api/glossary/marks/states", "POST", {
      termIds: ["bounded-context", "aggregate"],
    }),
  );
  expect(fakes.marks).toHaveBeenCalledWith(
    ["bounded-context", "aggregate"],
    "trusted-token",
  );
  expect(await ready.json()).toEqual({ kind: "ready", marks: [mark] });

  fakes.marks.mockResolvedValueOnce({
    ok: false,
    problem: null,
    response: new Response(null, { status: 503 }),
  });
  const failed = await handleTermMarks(
    request("/api/glossary/marks/states", "POST", {
      termIds: ["bounded-context"],
    }),
  );
  expect(await failed.json()).toEqual({ kind: "unavailable" });
});
