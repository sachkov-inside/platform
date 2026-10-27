import { z } from "zod";

import type { BillingFailureCode } from "@/entities/subscription";

const operationId = z.uuid();

/** Правило активации прежнего курса: код, который человек отправляет боту, и проверяемый источник. */
export const activationRuleSchema = z.object({
  id: z.uuid(),
  code: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/u),
  name: z.string().min(1).max(200),
  revision: z.int().positive(),
  productId: z.uuid(),
  sourceRef: z.string().min(1).max(256),
  verificationMode: z.literal("course_membership").optional(),
  published: z.boolean(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
});
export type ActivationRule = z.infer<typeof activationRuleSchema>;

export const listActivationRulesInputSchema = z.object({ operationId });
export const saveActivationRuleInputSchema = z.object({
  operationId,
  expectedRevision: z.int().positive().optional(),
  value: activationRuleSchema.omit({ revision: true }),
  reason: z.string().min(1).max(1000),
});
export type SaveActivationRuleInput = z.infer<
  typeof saveActivationRuleInputSchema
>;

export const activationRulesOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("activationRules"),
    items: z.array(activationRuleSchema),
  }),
});
export const activationRuleOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("activationRule"),
    value: activationRuleSchema,
  }),
});

/** Правила одного продукта в порядке названий: страница продукта не показывает чужие правила. */
export function productActivationRules(
  rules: readonly ActivationRule[],
  productId: string,
): readonly ActivationRule[] {
  return rules
    .filter((rule) => rule.productId === productId)
    .toSorted((left, right) => left.name.localeCompare(right.name, "ru"));
}

/** Поля формы нового правила; продукт берётся со страницы, а не из ввода. */
export interface NewActivationRuleDraft {
  readonly name: string;
  readonly code: string;
  readonly sourceRef: string;
  readonly reason: string;
  readonly published: boolean;
}

export type NewActivationRuleErrors = Partial<
  Record<"name" | "code" | "sourceRef" | "reason", string>
>;

/**
 * Проверка формы теми же границами, что у команды: пустое поле, длина и допустимые знаки кода.
 * Пустой результат означает, что форму можно отправить.
 */
export function newActivationRuleErrors(
  draft: NewActivationRuleDraft,
): NewActivationRuleErrors {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (name === "") errors["name"] = "Назовите правило";
  else if (name.length > 200) errors["name"] = "Не длиннее 200 знаков";
  const code = draft.code.trim();
  if (code === "") errors["code"] = "Укажите код";
  else if (!/^[A-Za-z0-9_-]{1,40}$/u.test(code))
    errors["code"] =
      "Латинские буквы, цифры, дефис и подчёркивание, до 40 знаков";
  const sourceRef = draft.sourceRef.trim();
  if (sourceRef === "") errors["sourceRef"] = "Укажите источник курса";
  else if (sourceRef.length > 256)
    errors["sourceRef"] = "Не длиннее 256 знаков";
  const reason = draft.reason.trim();
  if (reason === "") errors["reason"] = "Укажите причину";
  else if (reason.length > 1000) errors["reason"] = "Не длиннее 1000 знаков";
  return errors;
}

/** Причина, с которой записывается смена публикации существующего правила. */
export const publicationToggleReason = "Изменение публикации владельцем";

const activationRuleFailureMessages: Partial<
  Record<BillingFailureCode, string>
> = {
  revision_conflict:
    "Правило изменилось в другом месте. Обновите данные и проверьте его.",
  operation_conflict:
    "Правило с таким кодом или идентификатором уже есть. Обновите данные.",
  invalid_request: "Проверьте название, код, источник и причину.",
  not_found: "Продукт не найден. Обновите страницу.",
  forbidden: "У вас нет права менять правила активации.",
  unauthorized: "Сессия завершилась. Войдите снова.",
};

/** Отказ команды правил словами владельца; конфликт ревизии ведёт к перечитыванию, а не к повтору. */
export function activationRuleFailureMessage(code: BillingFailureCode): string {
  return (
    activationRuleFailureMessages[code] ??
    "Правила активации сейчас недоступны. Повторите позже."
  );
}
