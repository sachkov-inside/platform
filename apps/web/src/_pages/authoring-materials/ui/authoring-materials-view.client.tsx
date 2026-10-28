"use client";

import type { Route } from "next";
import Link from "next/link";

import { materialTaxonomyLabel } from "@/entities/material";
import {
  formatCountRu,
  formatMoscowDateTime,
} from "@/shared/lib/moscow-format";
import { authoringMaterialPreviewHref } from "@/shared/routing/authoring";
import {
  AdminEmptyState,
  AdminErrorState,
  AdminFilterBar,
  AdminListHeader,
  AdminNoResults,
  AdminPagination,
  AdminRowMenu,
  AdminTable,
  StateBadge,
  type AdminTableColumn,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import type {
  AuthoringMaterialFilterOptions,
  AuthoringMaterialsQuery,
  AuthoringMaterialsState,
} from "../model/authoring-materials-presentation";
import {
  authoringDestinationHref,
  authoringMaterialsFilterChips,
  authoringMaterialsHref,
  authoringMaterialsPageSummary,
  formatFilterLabel,
  hasAuthoringMaterialsFilters,
  publicationStateFilterLabels,
  resetAuthoringMaterialsQuery,
  topicFilterLabel,
  withAuthoringMaterialsFilter,
} from "../model/authoring-materials-query";
import {
  useAuthoringMaterialLifecycle,
  type AuthoringMaterialRow,
} from "./authoring-material-actions.client";
import { AuthoringMaterialsFrame } from "./authoring-materials-frame";
import { NewMaterialButton } from "./authoring-materials-loading";

const headingId = "authoring-materials-heading";
const materialForms = ["материал", "материала", "материалов"] as const;

export function AuthoringMaterialsView({
  filterOptions,
  isRefreshing = false,
  onQueryChange,
  onRetry,
  query,
  state,
}: {
  readonly filterOptions: AuthoringMaterialFilterOptions;
  readonly isRefreshing?: boolean;
  readonly onQueryChange: (query: AuthoringMaterialsQuery) => void;
  readonly onRetry: () => void;
  readonly query: AuthoringMaterialsQuery;
  readonly state: AuthoringMaterialsState;
}) {
  const returnHref = authoringMaterialsHref(query);
  if (state.kind !== "ready")
    return <AuthoringMaterialsFailure onRetry={onRetry} state={state} />;

  const filtered = hasAuthoringMaterialsFilters(query);
  const firstUse = state.totalItems === 0 && !filtered;
  return (
    <AuthoringMaterialsFrame labelledBy={headingId}>
      <AdminListHeader
        action={<NewMaterialButton returnHref={returnHref} />}
        count={formatCountRu(state.totalItems, materialForms)}
        headingId={headingId}
        title="Материалы"
      />
      <section
        aria-label="Список материалов"
        className="grid grid-cols-[minmax(0,1fr)] gap-4"
        data-authoring-materials-list
      >
        {firstUse ? (
          <AdminEmptyState
            action={
              <Button asChild className="min-h-11 px-4">
                <Link
                  href={authoringDestinationHref(
                    "/authoring/materials/new",
                    returnHref,
                  )}
                >
                  Создать материал
                </Link>
              </Button>
            }
            description="Создайте первый черновик: он сразу появится в этом списке."
            title="Материалов пока нет"
          />
        ) : (
          <>
            <AuthoringMaterialsFilters
              filterOptions={filterOptions}
              onQueryChange={onQueryChange}
              query={query}
              totalItems={state.totalItems}
            />
            <AuthoringMaterialsResults
              isRefreshing={isRefreshing}
              onQueryChange={onQueryChange}
              query={query}
              returnHref={returnHref}
              state={state}
            />
          </>
        )}
      </section>
    </AuthoringMaterialsFrame>
  );
}

function AuthoringMaterialsFilters({
  filterOptions,
  onQueryChange,
  query,
  totalItems,
}: {
  readonly filterOptions: AuthoringMaterialFilterOptions;
  readonly onQueryChange: (query: AuthoringMaterialsQuery) => void;
  readonly query: AuthoringMaterialsQuery;
  readonly totalItems: number;
}) {
  const filtered = hasAuthoringMaterialsFilters(query);
  const topics = filterOptions.kind === "ready" ? filterOptions.topics : [];
  const formats = filterOptions.kind === "ready" ? filterOptions.formats : [];
  return (
    <AdminFilterBar
      chips={authoringMaterialsFilterChips(query, filterOptions).map(
        (chip) => ({
          id: chip.id,
          label: chip.label,
          onRemove: () => {
            onQueryChange(chip.next);
          },
        }),
      )}
      filters={[
        {
          id: "state",
          label: "Состояние публикации",
          onChange: (value) => {
            onQueryChange(
              withAuthoringMaterialsFilter(
                query,
                "publicationState",
                value === allValue ? undefined : value,
              ),
            );
          },
          options: [
            { label: "Все состояния", value: allValue },
            ...Object.entries(publicationStateFilterLabels).map(
              ([value, label]) => ({ label, value }),
            ),
          ],
          value: query.publicationState ?? allValue,
        },
        {
          id: "topic",
          label: "Тема",
          onChange: (value) => {
            onQueryChange(
              withAuthoringMaterialsFilter(
                query,
                "topicId",
                value === allValue ? undefined : value,
              ),
            );
          },
          options: withSelected(
            [{ label: "Все темы", value: allValue }, ...topics],
            query.topicId,
            (value) => topicFilterLabel(value, filterOptions),
          ),
          value: query.topicId ?? allValue,
        },
        {
          id: "format",
          label: "Формат",
          onChange: (value) => {
            onQueryChange(
              withAuthoringMaterialsFilter(
                query,
                "format",
                value === allValue ? undefined : value,
              ),
            );
          },
          options: withSelected(
            [{ label: "Все форматы", value: allValue }, ...formats],
            query.format,
            (value) => formatFilterLabel(value, filterOptions),
          ),
          value: query.format ?? allValue,
        },
      ]}
      onReset={
        filtered
          ? () => {
              onQueryChange(resetAuthoringMaterialsQuery);
            }
          : undefined
      }
      resultLabel={
        filtered
          ? `Найдено: ${formatCountRu(totalItems, materialForms)}`
          : undefined
      }
      search={{
        label: "Поиск по названию, описанию или адресу",
        maxLength: 160,
        onChange: (value) => {
          onQueryChange(withAuthoringMaterialsFilter(query, "search", value));
        },
        placeholder: "Название, описание или адрес",
        value: query.search ?? "",
      }}
    />
  );
}

const allValue = "all";

/** The value in the address stays a choice even before (or without) the choices that name it. */
function withSelected(
  options: readonly { readonly label: string; readonly value: string }[],
  selected: string | undefined,
  label: (value: string) => string,
): { label: string; value: string }[] {
  const all = options.map((option) => ({ ...option }));
  if (selected === undefined || all.some((option) => option.value === selected))
    return all;
  return [...all, { label: label(selected), value: selected }];
}

function AuthoringMaterialsResults({
  isRefreshing,
  onQueryChange,
  query,
  returnHref,
  state,
}: {
  readonly isRefreshing: boolean;
  readonly onQueryChange: (query: AuthoringMaterialsQuery) => void;
  readonly query: AuthoringMaterialsQuery;
  readonly returnHref: Route;
  readonly state: Extract<AuthoringMaterialsState, { readonly kind: "ready" }>;
}) {
  const lifecycle = useAuthoringMaterialLifecycle();
  return (
    <>
      <AuthoringMaterialsRows
        isRefreshing={isRefreshing}
        lifecycle={lifecycle}
        onQueryChange={onQueryChange}
        query={query}
        returnHref={returnHref}
        state={state}
      />
      {/* The dialog and the announcement outlive the row: deleting the last row empties the page. */}
      {lifecycle.overlay}
    </>
  );
}

function AuthoringMaterialsRows({
  isRefreshing,
  lifecycle,
  onQueryChange,
  query,
  returnHref,
  state,
}: {
  readonly isRefreshing: boolean;
  readonly lifecycle: ReturnType<typeof useAuthoringMaterialLifecycle>;
  readonly onQueryChange: (query: AuthoringMaterialsQuery) => void;
  readonly query: AuthoringMaterialsQuery;
  readonly returnHref: Route;
  readonly state: Extract<AuthoringMaterialsState, { readonly kind: "ready" }>;
}) {
  if (state.items.length === 0) {
    if (state.totalItems > 0)
      return (
        <AdminNoResults
          description="Список стал короче, чем был, когда открывали эту страницу."
          onReset={() => {
            onQueryChange({ ...query, page: 1 });
          }}
          resetLabel="К первой странице"
          title="На этой странице больше нет материалов"
        />
      );
    return (
      <AdminNoResults
        description="Измените запрос или сбросьте фильтры, чтобы увидеть все материалы."
        onReset={() => {
          onQueryChange(resetAuthoringMaterialsQuery);
        }}
        title="Материалы не найдены"
      />
    );
  }

  const summary = authoringMaterialsPageSummary(state);
  const rows: AuthoringMaterialRow[] = state.items.map((listed) => {
    const item = lifecycle.current(listed);
    return {
      editorHref: authoringDestinationHref(
        `/authoring/materials/${item.materialId}`,
        returnHref,
      ),
      item,
      previewHref: authoringMaterialPreviewHref(item.materialId, returnHref),
      title: item.title ?? "Черновик без названия",
    };
  });
  return (
    <>
      {lifecycle.notice}
      <AdminTable
        busy={isRefreshing || lifecycle.pending}
        caption="Материалы"
        columns={columns}
        mobileItem={(row) => ({
          badge: <StateBadge state={`material.${row.item.publicationState}`} />,
          metric: (
            <time dateTime={row.item.updatedAt}>
              Изменён {formatMoscowDateTime(row.item.updatedAt)}
            </time>
          ),
          title: row.title,
        })}
        rowActions={(row) => (
          <AdminRowMenu
            items={lifecycle.menuItems(row)}
            label={`Действия с «${row.title}»`}
          />
        )}
        rowHref={(row) => row.editorHref}
        rowKey={(row) => row.item.materialId}
        rowTitle={(row) => row.title}
        rows={rows}
      />
      <AdminPagination
        label="Страницы материалов"
        onPage={(page) => {
          onQueryChange({ ...query, page });
        }}
        page={state.page}
        {...(summary === undefined ? {} : { summary })}
        totalPages={state.totalPages}
      />
    </>
  );
}

const columns: readonly AdminTableColumn<AuthoringMaterialRow>[] = [
  {
    cell: (row) =>
      `${taxonomyLabel(row.item.topic, "Без темы")} · ${taxonomyLabel(row.item.format, "Без формата")}`,
    header: "Название",
    id: "title",
  },
  {
    cell: (row) => (
      <StateBadge state={`material.${row.item.publicationState}`} />
    ),
    header: "Состояние",
    id: "state",
    width: "12rem",
  },
  {
    cell: (row) => (
      <time dateTime={row.item.updatedAt}>
        {formatMoscowDateTime(row.item.updatedAt)}
      </time>
    ),
    header: "Изменён",
    id: "updatedAt",
    width: "11rem",
  },
];

function taxonomyLabel(value: string | null, missing: string): string {
  return value === null ? missing : materialTaxonomyLabel(value);
}

function AuthoringMaterialsFailure({
  onRetry,
  state,
}: {
  readonly onRetry: () => void;
  readonly state: Exclude<AuthoringMaterialsState, { readonly kind: "ready" }>;
}) {
  const view = failureView(state);
  return (
    <AuthoringMaterialsFrame labelledBy={headingId}>
      <AdminListHeader headingId={headingId} title="Материалы" />
      <AdminErrorState
        description={view.description}
        {...(view.reference === undefined ? {} : { reference: view.reference })}
        {...(state.kind === "signed_out"
          ? {
              retry: (
                <form action="/auth/sign-in" method="post">
                  <Button className="min-h-11 px-4" type="submit">
                    Войти через Telegram
                  </Button>
                </form>
              ),
            }
          : { onRetry })}
        title={view.title}
      />
    </AuthoringMaterialsFrame>
  );
}

function failureView(
  state: Exclude<AuthoringMaterialsState, { readonly kind: "ready" }>,
): {
  readonly description: string;
  readonly reference?: string;
  readonly title: string;
} {
  switch (state.kind) {
    case "signed_out":
      return {
        description:
          "Войдите под аккаунтом автора, чтобы увидеть черновики и опубликованные материалы.",
        title: "Нужен вход автора",
      };
    case "forbidden":
      return {
        description:
          "У этого аккаунта нет права управлять материалами. Войдите под аккаунтом автора и повторите.",
        title: "Нет доступа к материалам",
      };
    case "unavailable":
      return {
        description:
          "Хранилище материалов временно недоступно. Материалы не изменились, повторите чтение.",
        reference: state.reference,
        title: "Список временно недоступен",
      };
    case "malformed_response":
      return {
        description:
          "Сервер вернул неполный ответ. Список не показан, чтобы не скрыть настоящее состояние материалов.",
        reference: "malformed-response",
        title: "Не удалось проверить список",
      };
    case "unexpected_error":
      return {
        description:
          "Чтение списка не удалось. Материалы не изменились, повторите запрос.",
        reference: state.reference,
        title: "Не удалось открыть материалы",
      };
  }
}
