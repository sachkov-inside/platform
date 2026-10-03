"use client";
import { useState } from "react";
import type { z } from "zod";

import {
  billingActionClass,
  cohortStageSchema,
  type CohortStage,
  type GuideCohort,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import type { SaveCohortInput } from "../model/admin-operations";
import type { contentCatalogOutcomeSchema } from "../model/enrollment-operations";
import type { AdminCommand } from "./admin-command";
import {
  AdminField,
  AdminSection,
  AdminSelect,
  formText,
  onAdminSubmit,
  optionalFormNumber,
  optionalFormText,
} from "./admin-form.client";

const stageLabels: Record<CohortStage, string> = {
  announcement: "Анонс: без оплаты, глава 1 бесплатно",
  preorder: "Предзаказ до старта",
  running: "Поток идёт",
  between: "Между потоками",
};

export interface CohortSectionProps {
  /** `null` — потоки прочитать не удалось; без текущей редакции сохранение получило бы конфликт. */
  readonly cohorts: readonly GuideCohort[] | null;
  readonly content?:
    z.infer<typeof contentCatalogOutcomeSchema>["result"]["items"] | undefined;
  readonly pending: boolean;
  readonly onSaveCohort: (input: AdminCommand<SaveCohortInput>) => void;
}

/**
 * Текущий поток продукта: этап продаж, название, дата старта и событие между потоками. Страница
 * курса показывает их со следующего запроса. Этап не включает продажу: кнопка оплаты появляется,
 * только пока у предложения продукта включена продажа. Новая цена после старта — архив
 * предложения потока и публикация следующего; купленные права не меняются.
 */
export function CohortSection({
  cohorts,
  content = [],
  pending,
  onSaveCohort,
}: CohortSectionProps) {
  const [editingId, setEditingId] = useState("");
  const editing = cohorts?.find((cohort) => cohort.guideId === editingId);
  const guides = content.filter((item) => item.kind === "guide");
  const guideName = (guideId: string) =>
    guides.find((item) => item.id === guideId)?.title ?? guideId;
  return (
    <AdminSection
      description="Этап, название и дата потока видны на странице продукта сразу после сохранения. Анонс никогда не принимает оплату; на остальных этапах кнопка оплаты видна, только пока предложение продукта в продаже."
      title="Поток продукта"
    >
      {cohorts === null ? (
        <p className="text-sm text-destructive" role="alert">
          Не удалось прочитать текущие потоки. Обновите страницу, прежде чем
          менять поток: без текущей редакции сохранение будет отклонено.
        </p>
      ) : cohorts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Потоков пока нет.</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {cohorts.map((cohort) => (
            <li
              className="flex flex-wrap items-center justify-between gap-2"
              key={cohort.guideId}
            >
              <span className="[overflow-wrap:anywhere]">
                {guideName(cohort.guideId)} · {cohort.name} ·{" "}
                {stageLabels[cohort.stage]}
                {cohort.startsOn === null ? "" : ` · старт ${cohort.startsOn}`}
                {cohort.nextEvent === "" ? "" : ` · ${cohort.nextEvent}`} · r
                {cohort.revision}
              </span>
              <Button
                onClick={() => {
                  setEditingId(cohort.guideId);
                }}
                variant="outline"
              >
                Изменить
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-4"
        key={`${editingId}:${String(editing?.revision ?? 0)}`}
        onSubmit={onAdminSubmit((form) => {
          const revision = optionalFormNumber(form.get("cohortRevision"));
          onSaveCohort({
            ...(revision === undefined ? {} : { expectedRevision: revision }),
            value: {
              guideId: formText(form.get("cohortGuide")),
              name: formText(form.get("cohortName")),
              stage: cohortStageSchema
                .catch("announcement")
                .parse(formText(form.get("cohortStage"))),
              startsOn: optionalFormText(form.get("cohortStartsOn")) ?? null,
              nextEvent: formText(form.get("cohortNextEvent")),
            },
          });
        })}
      >
        <AdminSelect
          label="Продукт"
          name="cohortGuide"
          options={guides.map((item) => ({
            value: item.id,
            label: item.title,
          }))}
          placeholder="Выберите продукт"
          {...(editing === undefined ? {} : { defaultValue: editing.guideId })}
        />
        <AdminField
          defaultValue={editing?.name}
          hint="Стоит на плашке как метка: «Поток 1», «Второй поток»."
          label="Название потока"
          maxLength={120}
          name="cohortName"
          required
        />
        <AdminSelect
          defaultValue={editing?.stage ?? "announcement"}
          label="Этап продаж"
          name="cohortStage"
          options={cohortStageSchema.options.map((stage) => ({
            value: stage,
            label: stageLabels[stage],
          }))}
        />
        <AdminField
          defaultValue={editing?.startsOn ?? undefined}
          hint="Нужна всем этапам, кроме «Между потоками»."
          label="Дата старта"
          name="cohortStartsOn"
          type="date"
        />
        <AdminField
          defaultValue={editing?.nextEvent}
          hint="Для этапа «Между потоками»: например, «эфир 15 декабря»."
          label="Событие следующего потока"
          maxLength={200}
          name="cohortNextEvent"
        />
        <AdminField
          defaultValue={editing?.revision}
          hint="Пусто — первый поток этого продукта."
          inputMode="numeric"
          label="Ожидаемая редакция"
          name="cohortRevision"
        />
        <p>
          <Button
            className={billingActionClass}
            // Без прочитанных потоков нет текущей редакции: сохранение подменило бы список.
            disabled={pending || cohorts === null}
            type="submit"
          >
            Сохранить поток
          </Button>
        </p>
      </form>
    </AdminSection>
  );
}
