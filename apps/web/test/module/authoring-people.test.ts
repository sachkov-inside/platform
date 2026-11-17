import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import { handlePeopleListRequest as realHandlePeopleListRequest } from "@/_pages/authoring-people.server";
import {
  parsePeopleListQuery,
  peopleFilterChips,
  peopleListHref,
  serializePeopleListQuery,
  withPeopleListFilter,
} from "@/_pages/authoring-people/model/people-list";
import { handlePersonCardRequest as realHandlePersonCardRequest } from "@/_pages/authoring-person.server";
import {
  historyActorLabel,
  joinRemindersText,
  paymentStateText,
  telegramFacts,
  telegramHref,
} from "@/_pages/authoring-person/model/person-card-presentation";
import { handleAccessProductCatalogRequest as realHandleAccessProductCatalogRequest } from "@/features/product-access-actions.server";
import {
  searchGroupEntries,
  searchGroupNote,
  searchGroupSchema,
} from "@/features/authoring-search/model/authoring-search";
import { annaCard, annaRow, storyProducts } from "@/storybook/people.fixtures";

const productId = storyProducts[0].productId;

const handlePeopleListRequest = (request: Request) =>
  session(() => realHandlePeopleListRequest(request));
const handlePersonCardRequest = (accountId: string) =>
  session(() => realHandlePersonCardRequest(accountId));
const handleAccessProductCatalogRequest = () =>
  session(() => realHandleAccessProductCatalogRequest());

beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession("owner-token");
  vi.stubGlobal("fetch", backend);
});
afterEach(() => vi.useRealTimers());

describe("people list address", () => {
  it("keeps q, product, origin, state and cursor and drops values outside the schema", () => {
    const query = parsePeopleListQuery({
      q: "  Анна   Петрова ",
      product: productId,
      origin: "manual",
      state: "revoked",
      cursor: "o:25",
    });
    expect(query).toEqual({
      search: "Анна Петрова",
      productId,
      origin: "manual",
      state: "revoked",
      cursor: "o:25",
    });
    expect(
      parsePeopleListQuery({
        product: "not-a-uuid",
        origin: "gift",
        state: "x",
      }),
    ).toEqual({});
    expect(serializePeopleListQuery(query, "query")).toBe(
      `query=%D0%90%D0%BD%D0%BD%D0%B0+%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%B2%D0%B0&product=${productId}&origin=manual&state=revoked&cursor=o%3A25`,
    );
    expect(peopleListHref({})).toBe("/authoring/people");
  });

  it("drops the cursor whenever a filter changes, because it belongs to the old set", () => {
    const next = withPeopleListFilter(
      { cursor: "o:25", state: "active" },
      "origin",
      "paid",
    );
    expect(next).toEqual({ state: "active", origin: "paid" });
    expect(withPeopleListFilter(next, "state", undefined)).toEqual({
      origin: "paid",
    });
  });

  it("names chips without showing a Product ID", () => {
    const chips = peopleFilterChips(
      { productId, origin: "course_activation", state: "active" },
      () => "Выбранный продукт",
    );
    expect(chips.map((chip) => chip.label)).toEqual([
      "Выбранный продукт",
      "Активация курса",
      "Доступ открыт",
    ]);
  });
});

describe("people list BFF", () => {
  it("passes the filters to Nest with the page size and validates the answer", async () => {
    backend.mockResolvedValueOnce(
      Response.json({
        items: [annaRow],
        total: 1,
        nextCursor: null,
        nameSearch: "available",
      }),
    );
    const response = await handlePeopleListRequest(
      new Request(
        `https://inside.example.test/api/authoring/people?query=anna&product=${productId}&state=active&cursor=o%3A25`,
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ kind: "ready", total: 1 });
    expectRequest("/authoring/people", {
      limit: "25",
      query: "anna",
      productId,
      state: "active",
      cursor: "o:25",
    });
  });
  it("refuses with 403 and no personal data, and reads a malformed body as a failed dependency", async () => {
    backend.mockResolvedValueOnce(
      Response.json({ code: "forbidden" }, { status: 403 }),
    );
    const forbidden = await handlePeopleListRequest(
      new Request("https://inside.example.test/api/authoring/people"),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ kind: "forbidden" });
    backend.mockResolvedValueOnce(
      Response.json({ items: [{ accountId: "x" }], total: 1 }),
    );
    const malformed = await handlePeopleListRequest(
      new Request("https://inside.example.test/api/authoring/people"),
    );
    expect(malformed.status).toBe(503);
    expect(await malformed.json()).not.toHaveProperty("items");
  });
});
describe("people list name truncation", () => {
  it("passes a truncated name search through as its own state", async () => {
    backend.mockResolvedValueOnce(
      Response.json({
        items: [annaRow],
        total: 50,
        nextCursor: "o:25",
        nameSearch: "truncated",
      }),
    );
    const response = await handlePeopleListRequest(
      new Request("https://inside.example.test/api/authoring/people?query=a"),
    );
    expect(await response.json()).toMatchObject({
      kind: "ready",
      nameSearch: "truncated",
      total: 50,
    });
  });
});
describe("people list BFF refusal", () => {
  it("answers a Nest 400 (stale or foreign cursor) as a refused query, not as an outage", async () => {
    backend.mockResolvedValueOnce(
      Response.json({ code: "invalid_request" }, { status: 400 }),
    );
    const response = await handlePeopleListRequest(
      new Request(
        "https://inside.example.test/api/authoring/people?cursor=stale-cursor",
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ kind: "invalid_query" });
  });
});
describe("person card BFF", () => {
  it("answers a ready card, a 404 for an unknown or malformed ID and keeps blocks independent", async () => {
    backend.mockImplementation((request) =>
      Promise.resolve(
        new URL(request.url).pathname ===
          `/authoring/people/${annaCard.person.accountId}`
          ? Response.json(annaCard)
          : Response.json({ code: "not_found" }, { status: 404 }),
      ),
    );
    const ready = await handlePersonCardRequest(annaCard.person.accountId);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ kind: "ready", card: annaCard });
    expectRequest(`/authoring/people/${annaCard.person.accountId}`, {});
    const missing = await handlePersonCardRequest(
      "96000000-0000-4000-8000-0000000009ff",
    );
    expect(missing.status).toBe(404);
    const malformed = await handlePersonCardRequest("not-a-uuid");
    expect(malformed.status).toBe(404);
    expect(backend).toHaveBeenCalledTimes(2);
  });
});

describe("person card presentation", () => {
  it("keeps unknown Telegram facts unknown instead of «no» or «fine»", () => {
    expect(
      telegramFacts({
        state: "ready",
        link: "linked",
        membership: "unknown",
        restriction: "external_unknown",
        marketing: "unknown",
        observedAt: null,
        joinReminders: null,
      }).map((fact) => fact.state),
    ).toEqual([
      "telegram.linked",
      "telegram.unknown",
      "telegram.restricted_outside",
      "telegram.unknown",
    ]);
  });

  it("names the join reminder count and the last one, and keeps an unreported count unknown", () => {
    expect(joinRemindersText(null)).toBe(
      "Напоминаний о вступлении в группу: неизвестно.",
    );
    expect(joinRemindersText({ sent: 0, lastAt: null })).toBe(
      "Напоминаний о вступлении в группу: нет.",
    );
    expect(
      joinRemindersText({ sent: 1, lastAt: "2026-10-10T09:00:00.000Z" }),
    ).toBe(
      "Напоминаний о вступлении в группу: 1, последнее 10 окт. 2026, 12:00.",
    );
    expect(
      joinRemindersText({ sent: 5, lastAt: "2026-10-16T09:00:00.000Z" }),
    ).toBe(
      "Напоминаний о вступлении в группу: 5, последнее 16 окт. 2026, 12:00.",
    );
    expect(joinRemindersText({ sent: 2, lastAt: null })).toBe(
      "Напоминаний о вступлении в группу: 2.",
    );
  });

  it("names actors and payment states without technical values", () => {
    expect(historyActorLabel({ kind: "system" })).toBe("Система");
    expect(historyActorLabel({ kind: "unknown" })).toBe("Автор неизвестен");
    expect(
      historyActorLabel({
        kind: "person",
        accountId: annaCard.person.accountId,
        label: null,
      }),
    ).toBe("Аккаунт без имени и email");
    expect(paymentStateText("confirmed")).toBe("Оплата подтверждена");
    expect(paymentStateText("refund_pending_v2")).toBe("Состояние уточняется");
  });

  it("links Telegram only to https://t.me", () => {
    expect(telegramHref("https://t.me/anna_petrova")).toBe(
      "https://t.me/anna_petrova",
    );
    expect(telegramHref("javascript:alert(1)")).toBeNull();
    expect(telegramHref("https://evil.example/anna_petrova")).toBeNull();
    expect(telegramHref("https://t.me.evil.example/anna")).toBeNull();
    expect(telegramHref("https://user@t.me/anna")).toBeNull();
    expect(telegramHref("http://t.me/anna")).toBeNull();
    expect(telegramHref("tg://resolve?domain=anna")).toBeNull();
    expect(telegramHref(null)).toBeNull();
  });
});

describe("product choices BFF", () => {
  it("returns Products sorted with archived last and keeps a refusal a refusal", async () => {
    backend.mockResolvedValueOnce(
      Response.json({
        items: [
          { productId, name: "Яндекс-практикум", archived: true },
          { productId, name: "Архитектура", archived: false },
        ],
      }),
    );
    const ready = await handleAccessProductCatalogRequest();
    expect(await ready.json()).toEqual({
      kind: "ready",
      products: [
        { productId, name: "Архитектура", archived: false },
        { productId, name: "Яндекс-практикум", archived: true },
      ],
    });
    expectRequest("/authoring/people/product-choices", {});
    backend.mockResolvedValueOnce(
      Response.json({ code: "forbidden" }, { status: 403 }),
    );
    const forbidden = await handleAccessProductCatalogRequest();
    expect(forbidden.status).toBe(403);
  });
});

describe("«Люди» search group", () => {
  const anna = {
    accountId: annaCard.person.accountId,
    displayName: "Анна Петрова",
    username: "anna_petrova",
    email: "anna.petrova@example.test",
    contactsState: "complete",
  } as const;

  it("accepts the people group and opens the card from a hit", () => {
    const group = searchGroupSchema.parse({
      kind: "people",
      state: "ready",
      partial: false,
      truncated: false,
      items: [anna],
    });
    expect(searchGroupEntries(group)).toEqual([
      {
        id: `people-${anna.accountId}`,
        href: `/authoring/people/${anna.accountId}`,
        title: "Анна Петрова",
        caption: "@anna_petrova · anna.petrova@example.test",
      },
    ]);
    expect(searchGroupNote(group)).toBeNull();
    expect(
      searchGroupSchema.safeParse({ kind: "people", state: "ready", items: [] })
        .success,
    ).toBe(false);
  });

  it("says that the name search was unavailable for a partial group", () => {
    const group = searchGroupSchema.parse({
      kind: "people",
      state: "ready",
      partial: true,
      truncated: false,
      items: [],
    });
    expect(searchGroupNote(group)).toMatch(/временно недоступен/u);
    expect(
      searchGroupNote(
        searchGroupSchema.parse({
          kind: "people",
          state: "ready",
          partial: false,
          truncated: true,
          items: [anna],
        }),
      ),
    ).toBe("Показаны не все совпадения. Уточните запрос.");
    expect(
      searchGroupSchema.parse({ kind: "people", state: "unavailable" }),
    ).toEqual({ kind: "people", state: "unavailable" });
  });
});

function expectRequest(path: string, query: Readonly<Record<string, string>>) {
  const request = backend.mock.calls.at(-1)?.[0];
  if (request === undefined)
    throw new Error("Expected owner People HTTP request");
  const url = new URL(request.url);
  expect(url.origin + url.pathname).toBe(
    `https://platform-api.example.test${path}`,
  );
  expect(request.method).toBe("GET");
  expect(Object.fromEntries(url.searchParams)).toEqual(query);
  expect(request.headers.get("authorization")).toBe("Bearer owner-token");
}
