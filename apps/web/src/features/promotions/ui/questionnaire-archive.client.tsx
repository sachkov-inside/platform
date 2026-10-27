"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { formatCountRu, formatMoscowDate } from "@/shared/lib/moscow-format";
import {
  AdminEmptyState,
  AdminErrorState,
  AdminPagination,
  AdminTable,
  AdminTableSkeleton,
  type AdminTableColumn,
} from "@/shared/ui/admin";

import { readQuestionnaireRespondents } from "../api/promotions.browser";
import type { RespondentsView } from "../model/promotion-operations";

export const questionnaireRespondentsQueryKey = [
  "owner-questionnaire-respondents",
] as const;
const pageSize = 50;
const respondentForms = ["респондент", "респондента", "респондентов"] as const;

type Respondent = RespondentsView["respondents"][number];

const columns: readonly AdminTableColumn<Respondent>[] = [
  { id: "username", header: "Ник из анкеты", cell: () => null },
  {
    id: "issued",
    header: "Личная ссылка",
    width: "12rem",
    cell: (row) =>
      row.issuedAt === null
        ? "Не выдана"
        : `Выдана ${formatMoscowDate(row.issuedAt)}`,
  },
  {
    id: "purchase",
    header: "Покупка",
    width: "10rem",
    cell: (row) => (row.purchased ? "Оплачена" : "Нет"),
  },
];

/**
 * Архив анкетных скидок (#815) только для чтения: сколько ников загружено, сколько личных ссылок
 * выдано и сколько покупок по ним. Импорт списка и выдача ссылок из админки убраны, операции
 * сервера остаются.
 */
export function QuestionnaireArchive() {
  const [page, setPage] = useState(1);
  const status = useQuery({
    queryKey: questionnaireRespondentsQueryKey,
    queryFn: async () => {
      const result = await readQuestionnaireRespondents({
        operationId: crypto.randomUUID(),
      });
      if (!result.ok) throw new Error(result.code);
      return result.value.result.value;
    },
  });

  if (status.isPending)
    return <AdminTableSkeleton columns={3} label="Загружаем анкетные скидки" />;
  if (status.isError)
    return (
      <AdminErrorState
        description="Сводка анкетных скидок не загрузилась."
        onRetry={() => {
          void status.refetch();
        }}
        title="Не удалось загрузить архив"
      />
    );
  const view = status.data;
  const totalPages = Math.max(1, Math.ceil(view.respondents.length / pageSize));
  const current = Math.min(page, totalPages);
  const rows = view.respondents.slice(
    (current - 1) * pageSize,
    current * pageSize,
  );
  return (
    <section
      aria-labelledby="questionnaire-archive-title"
      className="grid grid-cols-[minmax(0,1fr)] gap-4"
      data-questionnaire-archive
    >
      <div className="grid gap-1">
        <h2
          className="text-lg font-semibold tracking-[-0.02em]"
          id="questionnaire-archive-title"
        >
          Анкетные скидки
        </h2>
        <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
          Архив только для чтения. Новые ники и личные ссылки из админки больше
          не выдаются; выданные ссылки продолжают действовать по своим срокам.
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-4 rounded-xl border border-border bg-card p-4">
        <Figure label="Загружено ников" value={view.total} />
        <Figure label="Выдано ссылок" value={view.issued} />
        <Figure label="Купили по ссылке" value={view.purchased} />
      </dl>
      {view.respondents.length === 0 ? (
        <AdminEmptyState
          description="Список ников анкеты не загружали. Архив появится, если он был."
          title="Анкетных скидок нет"
        />
      ) : (
        <>
          <AdminTable
            caption="Респонденты анкеты"
            columns={columns}
            mobileItem={(row) => ({
              title: row.username,
              caption:
                row.issuedAt === null
                  ? "Ссылка не выдана"
                  : `Ссылка выдана ${formatMoscowDate(row.issuedAt)}`,
              metric: row.purchased ? "Оплачена" : "Без покупки",
            })}
            rowKey={(row) => row.username}
            rowTitle={(row) => row.username}
            rows={rows}
          />
          <AdminPagination
            label="Страницы респондентов"
            onPage={setPage}
            page={current}
            summary={`${String((current - 1) * pageSize + 1)}–${String((current - 1) * pageSize + rows.length)} из ${formatCountRu(view.respondents.length, respondentForms)}`}
            totalPages={totalPages}
          />
        </>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums sm:text-2xl">
        {value.toLocaleString("ru-RU")}
      </dd>
    </div>
  );
}
