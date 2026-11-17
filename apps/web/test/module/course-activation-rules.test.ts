import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { realBffSession } from "../support/real-bff-session";
import { ownerBillingBackend } from "../support/owner-billing-backend";
let backend: ReturnType<typeof ownerBillingBackend>;
let session: Awaited<ReturnType<typeof realBffSession>>;

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

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession("owner-token");
  backend = ownerBillingBackend();
});

afterEach(() => vi.useRealTimers());

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
    routeBrowserMutations(
      {
        "/api/authoring/billing/activation-rules/list": listRoute,
        "/api/authoring/billing/activation-rules/save": saveRoute,
      },
      undefined,
      { externalFetch: backend.fetch, run: (handler) => session(handler) },
    );
    const saved = rule("00000000-0000-4000-8000-000000000001", "Прежний курс");
    backend.command.mockResolvedValueOnce(
      Response.json({
        operationRef: operationId,
        result: { outcome: "activationRules", items: [saved] },
      }),
    );
    await expect(
      listCourseActivationRulesOperation.send({ operationId }),
    ).resolves.toEqual({
      ok: true,
      value: {
        operationRef: operationId,
        result: { outcome: "activationRules", items: [saved] },
      },
    });
    expect(await lastCommand()).toEqual({
      operation: "activationRules.list",
      operationId,
    });

    backend.command.mockResolvedValueOnce(
      Response.json({ code: "revision_conflict" }, { status: 409 }),
    );
    const { revision, ...value } = saved;
    await expect(
      saveCourseActivationRuleOperation.send({
        operationId,
        expectedRevision: revision,
        value: { ...value, published: false },
        reason: "Изменение публикации владельцем",
      }),
    ).resolves.toEqual({ ok: false, code: "revision_conflict" });
    expect(await lastCommand()).toEqual({
      operation: "activationRules.save",
      operationId,
      expectedRevision: revision,
      value: { ...value, published: false },
      reason: "Изменение публикации владельцем",
    });
    expect(backend.command).toHaveBeenCalledTimes(2);
  });
});

async function lastCommand(): Promise<unknown> {
  const request = backend.command.mock.calls.at(-1)?.[0];
  if (request === undefined) throw new Error("Expected owner Billing request");
  expect(request.headers.get("authorization")).toBe("Bearer owner-token");
  return request.json();
}
