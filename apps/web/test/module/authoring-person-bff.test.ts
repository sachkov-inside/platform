import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { peopleScenario } from "../../../../scenarios/people.mjs";
import { expectOwnerReadRequest } from "../support/owner-read-request";
import { realBffSession } from "../support/real-bff-session";
import {
  handlePeopleIdentitiesRequest,
  handlePeopleSearchRequest,
} from "@/entities/authoring-person.server";
import { personLabel } from "@/entities/authoring-person";

const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;
const anna = {
  accountId: "d1210000-0000-4000-8000-000000000001",
  ...peopleScenario.anna,
};
beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession("owner-token");
  vi.stubGlobal("fetch", backend);
});
afterEach(() => vi.useRealTimers());

const search = (query: string) =>
  session(() =>
    handlePeopleSearchRequest(
      new Request(
        `https://inside.example.test/api/authoring/people/search?${query}`,
      ),
    ),
  );
const identities = (ids: string) =>
  session(() =>
    handlePeopleIdentitiesRequest(
      new Request(
        `https://inside.example.test/api/authoring/people/identities?accountIds=${ids}`,
      ),
    ),
  );

describe("people search BFF", () => {
  it("passes the normalized query and limit and answers privately", async () => {
    backend.mockResolvedValueOnce(
      Response.json({ items: [anna], nameSearch: "available" }),
    );
    const response = await search("query=%20%20Анна%20%20Петрова%20&limit=5");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      kind: "ready",
      items: [anna],
      nameSearch: "available",
    });
    expect(backend).toHaveBeenCalledOnce();
    expectOwnerReadRequest(
      backend.mock.calls.at(-1)?.[0],
      "/authoring/people/search",
      {
        query: "Анна Петрова",
        limit: "5",
      },
    );
  });
  it("keeps an unavailable name search distinct from an empty answer", async () => {
    backend.mockResolvedValueOnce(
      Response.json({ items: [], nameSearch: "unavailable" }),
    );
    const response = await search("query=anna");
    expect(await response.json()).toEqual({
      kind: "ready",
      items: [],
      nameSearch: "unavailable",
    });
  });
  it("maps a refusal to 403 and rejects a blank query or a limit above 20 before the backend", async () => {
    backend.mockResolvedValueOnce(
      Response.json({ code: "forbidden" }, { status: 403 }),
    );
    const refused = await search("query=anna");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ kind: "forbidden" });
    for (const query of ["query=%20", "query=anna&limit=21"]) {
      backend.mockReset();
      const rejected = await search(query);
      expect(rejected.status).toBe(400);
      expect(backend).not.toHaveBeenCalled();
    }
  });
  it("does not pass a malformed backend body on", async () => {
    backend.mockResolvedValueOnce(
      Response.json({
        items: [{ ...anna, profileName: "Профиль" }],
        nameSearch: "available",
      }),
    );
    const response = await search("query=anna");
    expect(response.status).toBe(503);
    expect(response.headers.get("x-correlation-id")).toBe("malformed-response");
    expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
  });
});
describe("people identities BFF", () => {
  it("reads up to 100 account IDs and rejects more or a malformed ID", async () => {
    backend.mockResolvedValueOnce(Response.json({ items: [anna] }));
    const response = await identities(anna.accountId);
    expect(await response.json()).toEqual({ kind: "ready", items: [anna] });
    expect(backend).toHaveBeenCalledOnce();
    expectOwnerReadRequest(
      backend.mock.calls.at(-1)?.[0],
      "/authoring/people/identities",
      {
        accountIds: "d1210000-0000-4000-8000-000000000001",
      },
    );
    const tooMany = Array.from(
      { length: 101 },
      (_, index) =>
        `d1210000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    ).join(",");
    for (const ids of [tooMany, "not-an-id"]) {
      backend.mockReset();
      expect((await identities(ids)).status).toBe(400);
      expect(backend).not.toHaveBeenCalled();
    }
  });
});
describe("person label", () => {
  it("orders name, @username and email, and never titles a person by ID", () => {
    expect(personLabel(anna)).toEqual({
      title: "Анна Петрова",
      context: ["@anna_petrova", "anna.petrova@example.test"],
      missing: "Без имени и email",
    });
    expect(personLabel({ ...anna, displayName: null, username: null })).toEqual(
      {
        title: "anna.petrova@example.test",
        context: [],
        missing: "Без имени и email",
      },
    );
    expect(
      personLabel({
        accountId: anna.accountId,
        displayName: null,
        username: null,
        email: null,
        contactsState: "partial",
      }),
    ).toEqual({
      title: null,
      context: [],
      missing: "Контакты временно недоступны",
    });
  });
});
