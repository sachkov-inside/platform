"use client";
import { billingActionClass } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import type {
  AccountClassification,
  ClassificationOutcome,
  ClassifyAccountInput,
  ReadClassificationInput,
} from "../model/admin-operations";
import type { AdminCommand } from "./admin-command";
import {
  AdminCheckbox,
  AdminField,
  AdminSection,
  AdminSelect,
  AdminTextArea,
  formText,
  onAdminSubmit,
  reasonMaxLength,
} from "./admin-form.client";

export interface ClassificationSectionProps {
  readonly classification: ClassificationOutcome["result"]["value"] | null;
  readonly pending: boolean;
  readonly onReadClassification: (
    input: AdminCommand<ReadClassificationInput>,
  ) => void;
  readonly onClassifyAccount: (
    input: AdminCommand<ClassifyAccountInput>,
  ) => void;
}

/** Решение владельца словами покупателя: оно же объясняет, почему подписка ещё недоступна. */
const classificationLabels: Record<AccountClassification, string> = {
  confirmed_new: "новый покупатель",
  confirmed_legacy: "старый покупатель",
  unknown: "неизвестно",
};

export function ClassificationSection({
  classification,
  pending,
  onReadClassification,
  onClassifyAccount,
}: ClassificationSectionProps) {
  return (
    <AdminSection
      description="Пока покупатель не определён, подписку оформить нельзя: автосписания остаются запрещёнными. Переход Tribute относится только к старому покупателю."
      title="Кто этот покупатель"
    >
      <form
        className="grid gap-4"
        onSubmit={onAdminSubmit((form) => {
          onReadClassification({
            accountId: formText(form.get("classificationAccount")),
          });
        })}
      >
        <AdminField label="Account" name="classificationAccount" required />
        <p>
          <Button
            className={billingActionClass}
            disabled={pending}
            type="submit"
          >
            Показать состояние
          </Button>
        </p>
      </form>

      {classification === null ? null : (
        <div className="grid gap-1 border-t border-border pt-5 text-sm">
          <span className="font-mono text-xs [overflow-wrap:anywhere]">
            {classification.accountId} · r{classification.revision}
          </span>
          <span>
            {classificationLabels[classification.classification]} ·{" "}
            {classification.recurringAllowed
              ? "автосписания разрешены"
              : "автосписания запрещены"}
          </span>
        </div>
      )}

      <form
        className="grid gap-4 border-t border-border pt-5"
        onSubmit={onAdminSubmit((form) => {
          onClassifyAccount({
            accountId: formText(form.get("classifyAccount")),
            expectedRevision: Number(formText(form.get("classifyRevision"))),
            classification: classificationOf(form.get("classifyState")),
            sourceRef: formText(form.get("classifySource")),
            reason: formText(form.get("classifyReason")),
            bridgeEnabled: form.get("classifyBridge") !== null,
            tributeStopped: form.get("classifyTribute") !== null,
          });
        })}
      >
        <AdminField label="Определить Account" name="classifyAccount" required />
        <AdminField
          hint="Для аккаунта без решения — 0."
          inputMode="numeric"
          label="Ожидаемая редакция"
          name="classifyRevision"
          required
        />
        <AdminSelect
          label="Состояние"
          name="classifyState"
          options={[
            { value: "confirmed_new", label: "Новый покупатель" },
            { value: "confirmed_legacy", label: "Старый покупатель" },
            { value: "unknown", label: "Неизвестно" },
          ]}
        />
        <AdminField
          hint="Чем подтверждено решение: выгрузка, переписка, заявка."
          label="Источник"
          name="classifySource"
          required
        />
        <AdminCheckbox
          label="Включить переход старой группы"
          name="classifyBridge"
        />
        <AdminCheckbox
          label="Списания Tribute остановлены"
          name="classifyTribute"
        />
        <AdminTextArea
          label="Основание"
          maxLength={reasonMaxLength}
          name="classifyReason"
          required
        />
        <p>
          <Button
            className={billingActionClass}
            disabled={pending}
            type="submit"
          >
            Записать решение
          </Button>
        </p>
      </form>
    </AdminSection>
  );
}

/** Значение приходит из собственного списка формы; незнакомое остаётся «неизвестно». */
function classificationOf(value: FormDataEntryValue | null): AccountClassification {
  const entry = formText(value);
  return entry === "confirmed_new" || entry === "confirmed_legacy"
    ? entry
    : "unknown";
}
