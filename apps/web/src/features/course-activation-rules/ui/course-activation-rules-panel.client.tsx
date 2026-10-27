"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useId, useState, type SubmitEvent } from "react";

import type { BillingFailureCode } from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { StateBadge } from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import { listCourseActivationRulesOperation } from "../api/list-course-activation-rules.operation";
import { saveCourseActivationRuleOperation } from "../api/save-course-activation-rule.operation";
import {
  activationRuleFailureMessage,
  newActivationRuleErrors,
  productActivationRules,
  publicationToggleReason,
  type ActivationRule,
  type NewActivationRuleDraft,
  type NewActivationRuleErrors,
  type SaveActivationRuleInput,
} from "../model/course-activation-rules";

const rulesQueryKey = ["owner-activation-rules"] as const;

class ActivationRulesReadError extends Error {
  constructor(readonly code: BillingFailureCode) {
    super(activationRuleFailureMessage(code));
  }
}

const emptyDraft: NewActivationRuleDraft = {
  name: "",
  code: "",
  sourceRef: "",
  reason: "",
  published: false,
};

/**
 * Правила активации прежнего курса для одного продукта. Человек отправляет боту код правила, бот
 * проверяет его участие в источнике курса и текущую связь аккаунта и выдаёт этот продукт. Продукт
 * берётся со страницы, а не из ввода.
 */
export function CourseActivationRulesPanel({
  productId,
  productName,
}: {
  readonly productId: string;
  readonly productName: string;
}) {
  const headingId = useId();
  const cache = useQueryClient();
  const repeat = useRepeatableOperations();
  const [draft, setDraft] = useState(emptyDraft);
  const [errors, setErrors] = useState<NewActivationRuleErrors>({});
  const [failure, setFailure] = useState<BillingFailureCode | "lost" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<{
    readonly id: string;
    readonly startsAt: string;
  } | null>(null);
  const rules = useQuery({
    queryKey: rulesQueryKey,
    queryFn: async () => {
      const result = await listCourseActivationRulesOperation.send({
        operationId: crypto.randomUUID(),
      });
      if (!result.ok) throw new ActivationRulesReadError(result.code);
      return result.value.result.items;
    },
  });
  const save = useMutation({
    mutationFn: (input: {
      readonly slot: string;
      readonly command: SaveActivationRuleInput;
    }) => saveCourseActivationRuleOperation.send(input.command),
    retry: false,
    onSuccess: (result, { slot }) => {
      if (!result.ok) {
        setFailure(result.code);
        return;
      }
      repeat.completeOperation(slot);
      setFailure(null);
      if (slot === "new-rule") {
        setNewRule(null);
        setDraft(emptyDraft);
        setErrors({});
        setNotice("Правило создано.");
      } else
        setNotice(
          result.value.result.value.published
            ? "Правило опубликовано."
            : "Правило приостановлено.",
        );
      void cache.invalidateQueries({ queryKey: rulesQueryKey });
    },
    onError: () => {
      setFailure("lost");
    },
  });
  const own =
    rules.data === undefined
      ? null
      : productActivationRules(rules.data, productId);

  const togglePublication = (rule: ActivationRule) => {
    const { revision, ...value } = rule;
    const command = {
      expectedRevision: revision,
      value: { ...value, published: !rule.published },
      reason: publicationToggleReason,
    };
    const slot = `rule:${rule.id}`;
    setNotice(null);
    save.mutate({
      slot,
      command: { ...command, operationId: repeat.operationId(slot, command) },
    });
  };

  const create = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (save.isPending) return;
    const found = newActivationRuleErrors(draft);
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length > 0) return;
    // Новое правило сохраняет идентификатор и начало действия до успешной записи: повтор после
    // потерянного ответа пишет то же правило, а не второе.
    const identity = newRule ?? {
      id: crypto.randomUUID(),
      startsAt: new Date().toISOString(),
    };
    setNewRule(identity);
    const command = {
      value: {
        ...identity,
        name: draft.name.trim(),
        code: draft.code.trim(),
        productId,
        sourceRef: draft.sourceRef.trim(),
        verificationMode: "course_membership" as const,
        published: draft.published,
        endsAt: null,
      },
      reason: draft.reason.trim(),
    };
    save.mutate({
      slot: "new-rule",
      command: {
        ...command,
        operationId: repeat.operationId("new-rule", command),
      },
    });
  };

  const edit = (field: keyof NewActivationRuleDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  return (
    <section aria-labelledby={headingId} className="grid gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight" id={headingId}>
          Активация прежнего курса
        </h2>
        <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
          Участник прежнего курса отправляет боту код. Бот проверяет участие в
          источнике курса и связь аккаунта с Telegram, затем выдаёт продукт «
          {productName}».
        </p>
      </div>
      {failure === null ? null : (
        <div
          className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/35 bg-destructive/5 p-3 text-sm"
          role="alert"
        >
          <CircleAlert aria-hidden="true" className="size-4 text-destructive" />
          <span className="min-w-0 flex-1">
            {failure === "lost"
              ? "Ответ не дошёл. Повторите то же действие: правило не запишется дважды."
              : activationRuleFailureMessage(failure)}
          </span>
          {failure === "revision_conflict" ? (
            <Button
              className="min-h-11"
              onClick={() => {
                setFailure(null);
                void rules.refetch();
              }}
              type="button"
              variant="outline"
            >
              Обновить данные
            </Button>
          ) : null}
        </div>
      )}
      {notice === null ? null : (
        <p className="text-sm" role="status">
          {notice}
        </p>
      )}
      {rules.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Загружаем правила…
        </p>
      ) : rules.isError ? (
        <div className="grid gap-3" role="alert">
          <p className="text-sm">
            {rules.error instanceof ActivationRulesReadError
              ? rules.error.message
              : activationRuleFailureMessage("unavailable")}
          </p>
          <Button
            className="min-h-11 w-fit"
            onClick={() => {
              void rules.refetch();
            }}
            type="button"
            variant="outline"
          >
            Повторить
          </Button>
        </div>
      ) : own === null || own.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          У продукта пока нет правил активации.
        </p>
      ) : (
        <ul
          aria-label="Правила активации продукта"
          className="grid divide-y divide-border border-y border-border"
        >
          {own.map((rule) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-4"
              key={rule.id}
            >
              <div className="grid min-w-0 gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {rule.name}
                  </span>
                  <StateBadge
                    state={
                      rule.published
                        ? "activationRule.published"
                        : "activationRule.paused"
                    }
                  />
                </div>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  Код <span className="font-mono">{rule.code}</span>, источник{" "}
                  <span className="font-mono">{rule.sourceRef}</span>
                </p>
              </div>
              <Button
                className="min-h-11"
                disabled={save.isPending}
                onClick={() => {
                  togglePublication(rule);
                }}
                type="button"
                variant="outline"
              >
                {rule.published ? "Приостановить" : "Опубликовать"}
                <span className="sr-only">{` «${rule.name}»`}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        aria-labelledby={`${headingId}-new`}
        className="grid max-w-xl gap-4"
        noValidate
        onSubmit={create}
      >
        <h3 className="text-base font-semibold" id={`${headingId}-new`}>
          Новое правило
        </h3>
        <RuleField
          error={errors.name}
          label="Название правила"
          maxLength={200}
          onChange={(value) => {
            edit("name", value);
          }}
          value={draft.name}
        />
        <RuleField
          error={errors.code}
          hint="Его человек отправляет боту. Латинские буквы, цифры, дефис и подчёркивание."
          label="Код активации"
          maxLength={40}
          mono
          onChange={(value) => {
            edit("code", value);
          }}
          value={draft.code}
        />
        <RuleField
          error={errors.sourceRef}
          hint="Курс, участие в котором проверяет бот."
          label="Источник курса"
          maxLength={256}
          mono
          onChange={(value) => {
            edit("sourceRef", value);
          }}
          value={draft.sourceRef}
        />
        <RuleField
          error={errors.reason}
          label="Причина"
          maxLength={1000}
          onChange={(value) => {
            edit("reason", value);
          }}
          value={draft.reason}
        />
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            checked={draft.published}
            className="size-4 accent-primary"
            onChange={(event) => {
              const published = event.currentTarget.checked;
              setDraft((current) => ({ ...current, published }));
            }}
            type="checkbox"
          />
          Опубликовать сразу
        </label>
        <Button
          aria-busy={save.isPending}
          className="min-h-11 w-full sm:w-fit"
          disabled={save.isPending}
          type="submit"
        >
          Создать правило
        </Button>
      </form>
    </section>
  );
}

function RuleField({
  label,
  hint,
  error,
  value,
  onChange,
  maxLength,
  mono = false,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly error: string | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength: number;
  readonly mono?: boolean;
}) {
  const id = useId();
  const describedBy = [
    hint === undefined ? null : `${id}-hint`,
    error === undefined ? null : `${id}-error`,
  ]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <div className="admin-field">
      <label className="admin-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={error !== undefined}
        autoComplete="off"
        className={`min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive md:text-sm ${mono ? "font-mono" : ""}`}
        id={id}
        maxLength={maxLength}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        required
        type="text"
        value={value}
      />
      {hint === undefined ? null : (
        <p className="admin-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="admin-field-error" id={`${id}-error`}>
          <CircleAlert aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
