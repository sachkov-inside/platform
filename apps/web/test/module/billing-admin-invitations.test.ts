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
  handleIssueInvitation,
  handleListInvitations,
  handleRevokeInvitation,
} from "@/features/billing-admin.server";
import {
  canRevokeInvitation,
  invitationOfferChoices,
  invitationOfferNames,
  invitationSchema,
  invitationShareText,
  invitationStateLabel,
  invitationTermLabel,
  type Invitation,
} from "@/features/billing-admin/model/invitation-operations";
import { materialsOffer, supportOffer } from "@/workshop/billing.fixtures";

const origin = "https://inside.example.test";
const operationId = "20000000-0000-4000-8000-000000000001";
const offerId = materialsOffer.offer.id;
const invitationId = "00000000-0000-4000-8000-000000000e01";

const invitation: Invitation = {
  id: invitationId,
  code: "Syn7heticInvite",
  startParameter: "i_Syn7heticInvite",
  offerId,
  offerRevision: 3,
  mode: "purchase",
  giftMonths: null,
  note: "Для синтетического гостя",
  state: "issued",
  issuedAt: "2030-04-01T09:00:00.000Z",
  expiresAt: "2030-04-15T09:00:00.000Z",
  claimedAt: null,
  redeemedAt: null,
  revokedAt: null,
  accountId: null,
  revision: 1,
  link: "https://t.me/synthetic_inside_bot?start=i_Syn7heticInvite",
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
const problem = (code: string, status: number) => ({
  ok: false,
  problem: { code },
  response: new Response(null, { status }),
});

describe("подписи приглашения", () => {
  it("называет использованное приглашение по его результату", () => {
    expect(invitationStateLabel("issued", "purchase")).toBe("Выдано");
    expect(invitationStateLabel("claimed", "gift")).toBe("Открыто");
    expect(invitationStateLabel("redeemed", "purchase")).toBe("Оплата открыта");
    expect(invitationStateLabel("redeemed", "gift")).toBe("Подарено");
    expect(invitationStateLabel("expired", "gift")).toBe("Сгорело");
    expect(invitationStateLabel("revoked", "purchase")).toBe("Отозвано");
  });

  it("показывает срок только у подарка", () => {
    expect(invitationTermLabel({ mode: "gift", giftMonths: 3 })).toBe("3 мес.");
    expect(invitationTermLabel({ mode: "gift", giftMonths: null })).toBe(
      "Бессрочно",
    );
    expect(
      invitationTermLabel({ mode: "purchase", giftMonths: null }),
    ).toBeNull();
  });

  it("без готовой ссылки отдаёт параметр запуска бота", () => {
    expect(invitationShareText(invitation)).toBe(invitation.link);
    expect(invitationShareText({ ...invitation, link: null })).toBe(
      "i_Syn7heticInvite",
    );
  });

  it("разрешает отзыв только неиспользованного и живого приглашения", () => {
    expect(canRevokeInvitation({ state: "issued" })).toBe(true);
    expect(canRevokeInvitation({ state: "claimed" })).toBe(true);
    expect(canRevokeInvitation({ state: "redeemed" })).toBe(false);
    expect(canRevokeInvitation({ state: "expired" })).toBe(false);
    expect(canRevokeInvitation({ state: "revoked" })).toBe(false);
  });

  it("берёт названия из каталога и предлагает только действующие предложения по одному разу", () => {
    const archived = {
      ...supportOffer,
      offer: { ...supportOffer.offer, archived: true },
    };
    const secondOption = {
      ...materialsOffer,
      paymentOption: {
        ...materialsOffer.paymentOption,
        id: "00000000-0000-4000-8000-000000000299",
        months: 12,
      },
    };
    const catalog = [materialsOffer, secondOption, archived];
    expect(invitationOfferChoices(catalog)).toEqual([
      { id: offerId, name: "Материалы" },
    ]);
    expect(invitationOfferNames(catalog).get(supportOffer.offer.id)).toBe(
      "Материалы + сопровождение",
    );
  });

  it("принимает выдачу без заметки, как её возвращает сервер", () => {
    const { note: _note, ...withoutNote } = invitation;
    expect(invitationSchema.safeParse(withoutNote).success).toBe(true);
  });
});

describe("владельческие маршруты приглашений", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.token.mockResolvedValue("owner-token");
  });

  it("не отправляет срок для оплаты и превращает пустую заметку в null", async () => {
    fakes.manage.mockResolvedValue(
      ok({
        operationRef: operationId,
        result: { outcome: "invitation", value: invitation },
      }),
    );
    const response = await handleIssueInvitation(
      command("/api/authoring/billing/invitations/issue", {
        operationId,
        offerId,
        mode: "purchase",
        giftMonths: 6,
        note: "   ",
      }),
    );
    expect(await response.json()).toMatchObject({ ok: true });
    expect(fakes.manage).toHaveBeenCalledWith(
      {
        operation: "invitations.issue",
        operationId,
        offerId,
        mode: "purchase",
        giftMonths: null,
        note: null,
      },
      "owner-token",
      {},
    );
  });

  it("выдаёт бессрочный подарок с заметкой", async () => {
    fakes.manage.mockResolvedValue(
      ok({
        operationRef: operationId,
        result: {
          outcome: "invitation",
          value: { ...invitation, mode: "gift" },
        },
      }),
    );
    await handleIssueInvitation(
      command("/api/authoring/billing/invitations/issue", {
        operationId,
        offerId,
        mode: "gift",
        giftMonths: null,
        note: " Гость эфира ",
      }),
    );
    expect(fakes.manage).toHaveBeenCalledWith(
      {
        operation: "invitations.issue",
        operationId,
        offerId,
        mode: "gift",
        giftMonths: null,
        note: "Гость эфира",
      },
      "owner-token",
      {},
    );
  });

  it("не пропускает срок подарка вне границ команды", async () => {
    const response = await handleIssueInvitation(
      command("/api/authoring/billing/invitations/issue", {
        operationId,
        offerId,
        mode: "gift",
        giftMonths: 1201,
      }),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
    expect(fakes.manage).not.toHaveBeenCalled();
  });

  it("отзывает по ревизии и передаёт отказ сервера", async () => {
    fakes.manage.mockResolvedValue(problem("state_conflict", 409));
    const response = await handleRevokeInvitation(
      command("/api/authoring/billing/invitations/revoke", {
        operationId,
        invitationId,
        expectedRevision: 2,
      }),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "state_conflict",
    });
    expect(fakes.manage).toHaveBeenCalledWith(
      {
        operation: "invitations.revoke",
        operationId,
        invitationId,
        expectedRevision: 2,
      },
      "owner-token",
      {},
    );
  });

  it("читает страницу списка без пустых фильтров", async () => {
    fakes.manage.mockResolvedValue(
      ok({
        operationRef: operationId,
        result: {
          outcome: "invitations",
          items: [invitation],
          nextCursor: invitationId,
        },
      }),
    );
    const response = await handleListInvitations(
      command("/api/authoring/billing/invitations/list", {
        operationId,
        limit: 50,
        state: "claimed",
      }),
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      value: { result: { nextCursor: invitationId } },
    });
    expect(fakes.manage).toHaveBeenCalledWith(
      {
        operation: "invitations.list",
        operationId,
        limit: 50,
        state: "claimed",
      },
      "owner-token",
      {},
    );
  });
});
