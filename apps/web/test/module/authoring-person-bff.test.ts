import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));

import {
  handlePeopleIdentitiesRequest,
  handlePeopleSearchRequest,
  type PeopleReadsDependencies,
} from "@/entities/authoring-person.server";
import { personLabel } from "@/entities/authoring-person";

const anna = {
  accountId: "d1210000-0000-4000-8000-000000000001",
  displayName: "Анна Петрова",
  username: "anna_petrova",
  email: "anna.petrova@example.test",
};

function dependencies(
  answer: Awaited<ReturnType<PeopleReadsDependencies["search"]>>,
) {
  return {
    search: vi.fn(() => Promise.resolve(answer)),
    identities: vi.fn(() => Promise.resolve(answer)),
  } satisfies PeopleReadsDependencies;
}

function backendAnswer(status: number, body: unknown) {
  const response = new Response(null, { status });
  return status === 200
    ? ({ ok: true, body, response } as const)
    : ({ ok: false, problem: body, response } as const);
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("owner-token");
});

describe("people search BFF", () => {
  it("passes the normalized query and limit and answers privately", async () => {
    const read = dependencies(
      backendAnswer(200, { items: [anna], nameSearch: "available" }),
    );
    const response = await handlePeopleSearchRequest(
      new Request(
        "https://inside.example.test/api/authoring/people/search?query=%20%20Анна%20%20Петрова%20&limit=5",
      ),
      read,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      kind: "ready",
      items: [anna],
      nameSearch: "available",
    });
    expect(read.search).toHaveBeenCalledExactlyOnceWith(
      { text: "Анна Петрова", limit: 5 },
      "owner-token",
    );
  });

  it("keeps an unavailable name search distinct from an empty answer", async () => {
    const response = await handlePeopleSearchRequest(
      new Request(
        "https://inside.example.test/api/authoring/people/search?query=anna",
      ),
      dependencies(
        backendAnswer(200, { items: [], nameSearch: "unavailable" }),
      ),
    );
    expect(await response.json()).toEqual({
      kind: "ready",
      items: [],
      nameSearch: "unavailable",
    });
  });

  it("maps a refusal to 403 and rejects a blank query or a limit above 20 before the backend", async () => {
    const refused = await handlePeopleSearchRequest(
      new Request(
        "https://inside.example.test/api/authoring/people/search?query=anna",
      ),
      dependencies(backendAnswer(403, { code: "forbidden" })),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ kind: "forbidden" });
    for (const search of ["query=%20", "query=anna&limit=21"]) {
      const read = dependencies(backendAnswer(200, {}));
      const rejected = await handlePeopleSearchRequest(
        new Request(
          `https://inside.example.test/api/authoring/people/search?${search}`,
        ),
        read,
      );
      expect(rejected.status).toBe(400);
      expect(read.search).not.toHaveBeenCalled();
    }
  });

  it("does not pass a malformed backend body on", async () => {
    const response = await handlePeopleSearchRequest(
      new Request(
        "https://inside.example.test/api/authoring/people/search?query=anna",
      ),
      dependencies(
        backendAnswer(200, {
          items: [{ ...anna, profileName: "Профиль" }],
          nameSearch: "available",
        }),
      ),
    );
    // The shared read boundary answers every 503 alike and keeps the reference in its header.
    expect(response.status).toBe(503);
    expect(response.headers.get("x-correlation-id")).toBe("malformed-response");
    expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
  });
});

describe("people identities BFF", () => {
  it("reads up to 100 account IDs and rejects more or a malformed ID", async () => {
    const read = dependencies(backendAnswer(200, { items: [anna] }));
    const response = await handlePeopleIdentitiesRequest(
      new Request(
        `https://inside.example.test/api/authoring/people/identities?accountIds=${anna.accountId}`,
      ),
      read,
    );
    expect(await response.json()).toEqual({ kind: "ready", items: [anna] });
    expect(read.identities).toHaveBeenCalledExactlyOnceWith(
      [anna.accountId],
      "owner-token",
    );
    const tooMany = Array.from(
      { length: 101 },
      (_, index) =>
        `d1210000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    ).join(",");
    for (const ids of [tooMany, "not-an-id"]) {
      const rejected = dependencies(backendAnswer(200, {}));
      expect(
        (
          await handlePeopleIdentitiesRequest(
            new Request(
              `https://inside.example.test/api/authoring/people/identities?accountIds=${ids}`,
            ),
            rejected,
          )
        ).status,
      ).toBe(400);
      expect(rejected.identities).not.toHaveBeenCalled();
    }
  });
});

describe("person label", () => {
  it("orders name, @username and email, and never titles a person by ID", () => {
    expect(personLabel(anna)).toEqual({
      title: "Анна Петрова",
      context: ["@anna_petrova", "anna.petrova@example.test"],
    });
    expect(personLabel({ ...anna, displayName: null, username: null })).toEqual(
      { title: "anna.petrova@example.test", context: [] },
    );
    expect(
      personLabel({
        accountId: anna.accountId,
        displayName: null,
        username: null,
        email: null,
      }),
    ).toEqual({ title: null, context: [] });
  });
});
