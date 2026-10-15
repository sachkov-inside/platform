import { describe, expect, it } from "vitest";
import { GrammyUpdateAdapter } from "../../src/adapters/telegram/grammy-update.adapter.js";
import {
  activationMenu,
  activationMessage,
  accountPrompt,
} from "../../src/modules/subscription-activation/activation-view.js";
import type {
  ActivationResponse,
  ActivationResult,
} from "../../src/modules/subscription-activation/activation-contract.js";

const accountUrl = "https://platform.example/account";
const active: ActivationResult<ActivationResponse> = {
  ok: true,
  value: {
    contractVersion: "inside.subscription-activation.v1",
    attemptId: "example-attempt",
    state: "active",
    rule: {
      id: "rule",
      revision: 1,
      sourceRef: "course",
      product: {
        id: "625a0cca-c8ff-4a65-9125-17194dd3b769",
        slug: "ai-engineering",
        name: "AI Engineering",
      },
    },
    enrollment: {
      id: "example-enrollment",
      tier: {
        name: "AI Engineering",
        benefits: [
          "product:625a0cca-c8ff-4a65-9125-17194dd3b769",
          "community",
          "support",
        ],
      },
      origin: "course",
      startsAt: "2026-10-14T10:00:00.000Z",
      endsAt: null,
      state: "active",
      renewal: "not_applicable",
    },
  },
};

describe("learner activation messages", () => {
  it("preserves the course on recheck while accepting legacy buttons", () => {
    const adapter = new GrammyUpdateAdapter();
    const translate = (data: string) =>
      adapter.translate(
        "inside",
        "1",
        {
          update_id: 1,
          callback_query: {
            id: "callback",
            data,
            from: { id: 42, is_bot: false },
            message: { message_id: 1, chat: { id: 42, type: "private" } },
          },
        },
        new Date("2026-10-14T10:00:00.000Z"),
      );
    expect(translate("access:retry:course")).toMatchObject({
      kind: "access-action",
      action: "retry",
      activationCode: "course",
    });
    expect(translate("access:retry")).toMatchObject({
      kind: "access-action",
      action: "retry",
    });
    expect(translate("access:retry")).not.toHaveProperty("activationCode");
    expect(translate("access:retry:invalid!")).toMatchObject({
      kind: "ignored",
    });
  });

  it("confirms the course with only the platform and entitled chat actions", () => {
    expect(activationMessage(active)).toBe(
      "AI Engineering\n\nКурс доступен. Открывайте материалы и присоединяйтесь к группе курса.",
    );
    expect(activationMenu(accountUrl, active)).toEqual([
      {
        text: "Открыть курс",
        url: "https://sachkov.dev/products/ai-engineering/programme",
      },
      {
        text: "Вступить в группу",
        callbackData: "access:community:625a0cca-c8ff-4a65-9125-17194dd3b769",
      },
      {
        text: "Помощь",
        callbackData: "access:help:625a0cca-c8ff-4a65-9125-17194dd3b769",
      },
      { text: "Мои продукты", callbackData: "access:own" },
    ]);
  });

  it("does not advertise a chat for a product-only activation", () => {
    const result = structuredClone(active);
    if (!result.value.enrollment) throw new Error("Invalid fixture");
    const productOnly: ActivationResult<ActivationResponse> = {
      ok: true,
      value: {
        ...result.value,
        enrollment: {
          ...result.value.enrollment,
          tier: {
            ...result.value.enrollment.tier,
            benefits: ["product:625a0cca-c8ff-4a65-9125-17194dd3b769"],
          },
        },
      },
    };
    expect(activationMenu(accountUrl, productOnly)).toEqual([
      {
        text: "Открыть курс",
        url: "https://sachkov.dev/products/ai-engineering/programme",
      },
      {
        text: "Помощь",
        callbackData: "access:help:625a0cca-c8ff-4a65-9125-17194dd3b769",
      },
      { text: "Мои продукты", callbackData: "access:own" },
    ]);
  });

  it("offers Platform continuation without a manual linking prerequisite", () => {
    expect(accountPrompt(accountUrl)).toEqual({
      text: "Войдите на платформу и подключите Telegram, чтобы видеть свои продукты.",
      buttons: [
        {
          text: "Продолжить на платформе",
          url: "https://sachkov.dev/account/access",
        },
        { text: "Помощь", callbackData: "access:help" },
      ],
    });
  });
});
