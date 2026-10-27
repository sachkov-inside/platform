import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn<() => Promise<string>>(),
  manage: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestManageBilling: fakes.manage,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: () => fakes.token(),
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));

import * as listRoute from "../../app/api/authoring/billing/activation-rules/list/route";
import * as saveRoute from "../../app/api/authoring/billing/activation-rules/save/route";
import { listCourseActivationRulesOperation } from "@/features/course-activation-rules/api/list-course-activation-rules.operation";
import { saveCourseActivationRuleOperation } from "@/features/course-activation-rules/api/save-course-activation-rule.operation";
import {
  newActivationRuleErrors,
  productActivationRules,
  type ActivationRule,
} from "@/features/course-activation-rules/model/course-activation-rules";

import { routeBrowserMutations } from "../support/mutation-operation-route";

const productId = "00000000-0000-4000-8000-000000001718";
const operationId = "20000000-0000-4000-8000-000000000001";

function rule(
  id: string,
  name: string,
  owner: string = productId,
): ActivationRule {
  return {
    id,
    code: "AIENG2025",
    name,
    revision: 1,
    productId: owner,
    sourceRef: "inside-course:ai-engineering-2025",
    verificationMode: "course_membership",
    published: true,
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  fakes.token.mockResolvedValue("owner-token");
});

describe("правила активации на странице продукта", () => {
  it("показывает только правила этого продукта по названию", () => {
    const rules = [
      rule("00000000-0000-4000-8000-000000000003", "Поток весны"),
      rule(
        "00000000-0000-4000-8000-000000000002",
        "Чужой продукт",
        "00000000-0000-4000-8000-000000009999",
      ),
      rule("00000000-0000-4000-8000-000000000001", "Весь прежний курс"),
    ];
    expect(
      productActivationRules(rules, productId).map(({ name }) => name),
    ).toEqual(["Весь прежний курс", "Поток весны"]);
  });

  it("проверяет форму теми же границами, что команда, и не просит продукт", () => {
    expect(
      newActivationRuleErrors({
        name: " ",
        code: "код курса",
        sourceRef: "",
        reason: "",
        published: false,
      }),
    ).toEqual({
      name: "Назовите правило",
      code: "Латинские буквы, цифры, дефис и подчёркивание, до 40 знаков",
      sourceRef: "Укажите источник курса",
      reason: "Укажите причину",
    });
    expect(
      newActivationRuleErrors({
        name: "Прежний курс",
        code: "AIENG-2025",
        sourceRef: "inside-course:ai-engineering-2025",
        reason: "Перенос участников прежнего курса",
        published: true,
      }),
    ).toEqual({});
  });

  it("читает и сохраняет правила прежними командами через свои маршруты", async () => {
    routeBrowserMutations({
      "/api/authoring/billing/activation-rules/list": listRoute,
      "/api/authoring/billing/activation-rules/save": saveRoute,
    });
    const saved = rule("00000000-0000-4000-8000-000000000001", "Прежний курс");
    fakes.manage.mockResolvedValueOnce({
      ok: true,
      body: {
        operationRef: operationId,
        result: { outcome: "activationRules", items: [saved] },
      },
      response: new Response(),
    });
    await expect(
      listCourseActivationRulesOperation.send({ operationId }),
    ).resolves.toEqual({
      ok: true,
      value: {
        operationRef: operationId,
        result: { outcome: "activationRules", items: [saved] },
      },
    });
    expect(fakes.manage).toHaveBeenLastCalledWith(
      { operation: "activationRules.list", operationId },
      "owner-token",
      {},
    );

    fakes.manage.mockResolvedValueOnce({
      ok: false,
      problem: { code: "revision_conflict" },
      response: new Response(null, { status: 409 }),
    });
    const { revision, ...value } = saved;
    await expect(
      saveCourseActivationRuleOperation.send({
        operationId,
        expectedRevision: revision,
        value: { ...value, published: false },
        reason: "Изменение публикации владельцем",
      }),
    ).resolves.toEqual({ ok: false, code: "revision_conflict" });
    expect(fakes.manage).toHaveBeenLastCalledWith(
      {
        operation: "activationRules.save",
        operationId,
        expectedRevision: revision,
        value: { ...value, published: false },
        reason: "Изменение публикации владельцем",
      },
      "owner-token",
      {},
    );
    expect(fakes.manage).toHaveBeenCalledTimes(2);
  });
});
