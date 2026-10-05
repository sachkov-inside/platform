import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ token: vi.fn(), manage: vi.fn() }));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestManageBilling: fakes.manage,
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.token,
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));

import {
  handleAccessSummary,
  handleListPeople,
  handleSaveOffer,
} from "@/features/billing-admin.server";
import {
  eligibilityChoices,
  eligibilitySave,
  endOfMoscowDay,
  groundActions,
  lastMoscowDay,
  peopleOutcomeSchema,
  tariffRows,
  type PersonGround,
} from "@/features/billing-admin/model/access-operations";
import {
  guideOnlyOffer,
  materialsOffer,
  supportOffer,
} from "@/storybook/billing.fixtures";

const origin = "https://inside.example.test";
const operationId = "20000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000c01";

const ground: PersonGround = {
  kind: "enrollment",
  id: "00000000-0000-4000-8000-000000000d01",
  revision: 2,
  source: "platform_payment",
  offer: { id: materialsOffer.offer.id, name: "Материалы" },
  capabilities: ["materials"],
  purchaseRef: null,
  startsAt: "2030-03-01T00:00:00.000Z",
  endsAt: "2030-04-01T00:00:00.000Z",
  revokedAt: null,
  endPolicy: "fixed",
  state: "active",
};

function command(url: string, input: unknown): Request {
  const body = new FormData();
  body.set("input", JSON.stringify(input));
  return new Request(`${origin}${url}`, {
    method: "POST",
    headers: { origin },
    body,
  });
}
const ok = (body: unknown) => ({ ok: true, body, response: new Response() });

describe("действия карточки человека", () => {
  it("назначение продлевают, отзывают и восстанавливают, курс только отзывают", () => {
    // Назначение из платежа принадлежит Billing: его меняют отмена продления и возврат.
    expect(groundActions(ground)).toEqual({
      extend: false,
      revoke: false,
      restore: false,
    });
    const manual: PersonGround = { ...ground, source: "manual" };
    expect(groundActions(manual)).toEqual({
      extend: true,
      revoke: true,
      restore: false,
    });
    expect(groundActions({ ...ground, source: "course" })).toEqual({
      extend: false,
      revoke: true,
      restore: false,
    });
    expect(
      groundActions({
        ...manual,
        state: "revoked",
        revokedAt: ground.startsAt,
      }),
    ).toEqual({ extend: false, revoke: false, restore: true });
    expect(groundActions({ ...manual, state: "ended" })).toEqual({
      extend: true,
      revoke: false,
      restore: false,
    });
  });

  it("ручное право меняют командами прав, разовую покупку — только возвратом", () => {
    const grant: PersonGround = {
      ...ground,
      kind: "grant",
      source: "manual",
      offer: null,
      endPolicy: null,
    };
    expect(groundActions(grant)).toEqual({
      extend: true,
      revoke: true,
      restore: false,
    });
    expect(
      groundActions({
        ...grant,
        source: "one_time_purchase",
        purchaseRef: accountId,
      }),
    ).toEqual({ extend: false, revoke: false, restore: false });
  });

  it("срок «до дня» включает этот день по Москве и читается обратно тем же днём", () => {
    expect(endOfMoscowDay("2030-04-30")).toBe("2030-04-30T21:00:00.000Z");
    expect(lastMoscowDay("2030-04-30T21:00:00.000Z")).toBe("2030-04-30");
    expect(lastMoscowDay(ground.endsAt ?? "")).toBe("2030-04-01");
  });
});

describe("тарифы", () => {
  it("показывают действующий Offer один раз со всеми действующими ценами", () => {
    const yearly = {
      ...materialsOffer,
      paymentOption: {
        ...materialsOffer.paymentOption,
        id: "00000000-0000-4000-8000-000000000299",
        months: 12,
        priceKopecks: 1_000_000,
      },
    };
    const archivedOption = {
      ...materialsOffer,
      paymentOption: {
        ...materialsOffer.paymentOption,
        id: "00000000-0000-4000-8000-000000000298",
        archived: true,
      },
    };
    const archivedOffer = {
      ...supportOffer,
      offer: { ...supportOffer.offer, archived: true },
    };
    const rows = tariffRows([
      materialsOffer,
      yearly,
      archivedOption,
      archivedOffer,
      guideOnlyOffer,
    ]);
    expect(rows.map((row) => row.offer.id)).toEqual([
      materialsOffer.offer.id,
      guideOnlyOffer.offer.id,
    ]);
    expect(rows[0]?.options.map((option) => option.months)).toEqual([1, 12]);
    expect(rows[1]?.options[0]?.mode).toBe("one_time");
  });

  it("сохраняет допуск, не меняя состав и признак назначения", () => {
    const offer = {
      ...supportOffer.offer,
      availableForAssignment: true,
    };
    expect(eligibilitySave(offer, "invitation_only")).toEqual({
      expectedRevision: 4,
      value: {
        id: offer.id,
        name: offer.name,
        benefits: offer.benefits,
        benefitPeriods: offer.benefitPeriods,
        availableForAssignment: true,
        eligibility: "invitation_only",
      },
    });
  });

  it("предлагает двух адресатов продажи и оставляет прежний допуск Tribute, пока он задан", () => {
    expect(eligibilityChoices("everyone")).toEqual([
      "everyone",
      "invitation_only",
    ]);
    expect(eligibilityChoices("former_tribute_subscribers")).toContain(
      "former_tribute_subscribers",
    );
  });
});

describe("владельческие маршруты раздела «Доступ»", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.token.mockResolvedValue("owner-token");
  });

  it("читает людей с фильтрами и без пустых полей", async () => {
    const body = {
      operationRef: operationId,
      result: {
        outcome: "people",
        items: [
          { accountId, telegramIdentityRef: "tg-synthetic", grounds: [ground] },
        ],
        nextCursor: accountId,
      },
    };
    expect(peopleOutcomeSchema.safeParse(body).success).toBe(true);
    fakes.manage.mockResolvedValue(ok(body));
    const response = await handleListPeople(
      command("/api/authoring/billing/people/list", {
        operationId,
        limit: 50,
        source: "invitation",
        state: "expiring",
      }),
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      value: { result: { nextCursor: accountId } },
    });
    expect(fakes.manage).toHaveBeenCalledWith(
      {
        operation: "people.list",
        operationId,
        limit: 50,
        source: "invitation",
        state: "expiring",
      },
      "owner-token",
      {},
    );
  });

  it("не пропускает неизвестный источник и страницу больше 100", async () => {
    for (const input of [
      { operationId, limit: 101 },
      { operationId, limit: 50, source: "gift" },
    ]) {
      const response = await handleListPeople(
        command("/api/authoring/billing/people/list", input),
      );
      expect(await response.json()).toMatchObject({
        ok: false,
        code: "invalid_request",
      });
    }
    expect(fakes.manage).not.toHaveBeenCalled();
  });

  it("читает сводку одной командой", async () => {
    fakes.manage.mockResolvedValue(
      ok({
        operationRef: operationId,
        result: {
          outcome: "accessSummary",
          value: {
            asOf: "2030-03-15T12:00:00.000Z",
            active: [],
            invitations: {
              issued: 0,
              opened: 0,
              purchaseOpened: 0,
              paid: 0,
              gifted: 0,
              expired: 0,
              revoked: 0,
            },
            attention: [],
            revenue: [],
          },
        },
      }),
    );
    const response = await handleAccessSummary(
      command("/api/authoring/billing/access-summary", { operationId }),
    );
    expect(await response.json()).toMatchObject({ ok: true });
    expect(fakes.manage).toHaveBeenCalledWith(
      { operation: "access.summary", operationId },
      "owner-token",
      {},
    );
  });

  it("сохранение Offer передаёт допуск только когда он назван", async () => {
    fakes.manage.mockResolvedValue(
      ok({
        operationRef: operationId,
        result: {
          outcome: "catalog",
          value: { id: materialsOffer.offer.id, revision: 4, archived: false },
        },
      }),
    );
    const value = {
      id: materialsOffer.offer.id,
      name: "Материалы",
      benefits: ["materials"],
    };
    await handleSaveOffer(
      command("/api/authoring/billing/offers/save", {
        operationId,
        expectedRevision: 3,
        value: { ...value, eligibility: "invitation_only" },
      }),
    );
    expect(fakes.manage).toHaveBeenLastCalledWith(
      {
        operation: "offers.save",
        operationId,
        expectedRevision: 3,
        value: { ...value, eligibility: "invitation_only" },
      },
      "owner-token",
      {},
    );
    await handleSaveOffer(
      command("/api/authoring/billing/offers/save", {
        operationId,
        expectedRevision: 3,
        value,
      }),
    );
    expect(fakes.manage).toHaveBeenLastCalledWith(
      { operation: "offers.save", operationId, expectedRevision: 3, value },
      "owner-token",
      {},
    );
  });
});
