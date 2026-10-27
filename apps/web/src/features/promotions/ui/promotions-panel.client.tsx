"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import {
  ownerPriceCatalogQueryKey,
  productPriceChoices,
  readOwnerPriceCatalog,
} from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import {
  AdminConfirmDialog,
  AdminEmptyState,
  AdminErrorState,
  AdminFilterBar,
  AdminListHeader,
  AdminNoResults,
  AdminRowMenu,
  AdminTable,
  AdminTableSkeleton,
  StateBadge,
  type AdminTableColumn,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import { archivePromotion, listPromotions } from "../api/promotions.browser";
import {
  emptyPromotionForm,
  promotionFormFromItem,
} from "../model/promotion-form";
import type { PromotionListItem } from "../model/promotion-operations";
import {
  isPromotionEditable,
  promotionBadge,
  promotionState,
  type PromotionState,
} from "../model/promotion-state";
import {
  archiveFailureMessage,
  defaultPromotionsFilter,
  promotionPeriodLabel,
  promotionScope,
  promotionUsageLabel,
  type DiscountsView,
  type PromotionScope,
  type PromotionsFilter,
} from "../model/promotions-presentation";
import {
  PromotionFormDialog,
  type PromotionDraft,
} from "./promotion-form-dialog.client";
import { QuestionnaireArchive } from "./questionnaire-archive.client";

export const promotionsQueryKey = ["owner-promotions"] as const;
const pageSize = 50;
const allValue = "all";
const headingId = "promotions-heading";

interface PromotionRow {
  readonly item: PromotionListItem;
  readonly state: PromotionState;
  readonly scope: PromotionScope;
}

export interface PromotionsPanelProps {
  readonly filter: PromotionsFilter;
  readonly onFilterChange: (filter: PromotionsFilter) => void;
}

/**
 * Страница «Скидки»: список Promotion владельца с продуктами, периодом, кодом, процентом и
 * применениями; создание и изменение формой, архив из «⋯». Подраздел «Анкетные скидки» только
 * для чтения.
 */
export function PromotionsPanel({
  filter,
  onFilterChange,
}: PromotionsPanelProps) {
  const cache = useQueryClient();
  const repeat = useRepeatableOperations();
  const [draft, setDraft] = useState<PromotionDraft | null>(null);
  const [archiving, setArchiving] = useState<PromotionListItem | null>(null);
  const [archiveError, setArchiveError] = useState<{
    readonly message: string;
    readonly conflict: boolean;
  } | null>(null);
  const [status, setStatus] = useState("");

  const catalog = useQuery({
    queryKey: ownerPriceCatalogQueryKey,
    queryFn: async () => {
      const result = await readOwnerPriceCatalog();
      if (!result.ok) throw new Error(result.code);
      return result.value;
    },
  });
  const choices =
    catalog.data === undefined ? [] : productPriceChoices(catalog.data);
  const productName = (id: string) =>
    choices.find((choice) => choice.productId === id)?.name;

  const list = useInfiniteQuery({
    queryKey: [...promotionsQueryKey, filter.productId, filter.archived],
    enabled: filter.view === "promotions",
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listPromotions({
        operationId: crypto.randomUUID(),
        limit: pageSize,
        archived: filter.archived,
        ...(filter.productId === null ? {} : { productId: filter.productId }),
        ...(pageParam === null ? {} : { cursor: pageParam }),
      });
      if (!result.ok) throw new Error(result.code);
      // Состояние скидки считается на момент этого чтения, а не во время отрисовки.
      return { ...result.value.result, readAt: Date.now() };
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: promotionsQueryKey });
  };

  const archive = useMutation({
    mutationFn: archivePromotion,
    retry: false,
    onError: () => {
      setArchiveError({
        message:
          "Ответ не получен. Повторите: повтор не архивирует скидку дважды.",
        conflict: false,
      });
    },
    onSuccess: (result, input) => {
      if (!result.ok) {
        setArchiveError({
          message: archiveFailureMessage(result.code),
          conflict: result.code === "revision_conflict",
        });
        return;
      }
      repeat.completeOperation(`archive:${input.id}`);
      setStatus(
        `Скидка «${archiving?.name ?? ""}» в архиве. Сохранённые расчёты и оплаты не изменились.`,
      );
      setArchiving(null);
      refresh();
    },
  });

  const rows: PromotionRow[] =
    list.data?.pages.flatMap((page) =>
      page.items.map((item) => ({
        item,
        state: promotionState(item, new Date(page.readAt)),
        scope: promotionScope(item, productName),
      })),
    ) ?? [];
  const filtered = filter.productId !== null || filter.archived;
  const reset = () => {
    onFilterChange({ ...defaultPromotionsFilter });
  };
  const openCreate = () => {
    setStatus("");
    setDraft({
      id: crypto.randomUUID(),
      initial: emptyPromotionForm(
        filter.productId === null ? [] : [filter.productId],
      ),
    });
  };
  const createButton = (
    <Button className="min-h-11 px-4" onClick={openCreate} type="button">
      <Plus aria-hidden="true" data-icon="inline-start" />
      Создать скидку
    </Button>
  );

  const columns: readonly AdminTableColumn<PromotionRow>[] = [
    {
      id: "name",
      header: "Скидка",
      cell: (row) =>
        row.item.code === null ? "Без промокода" : `Промокод ${row.item.code}`,
    },
    {
      id: "products",
      header: "Продукты",
      width: "16rem",
      cell: (row) => <ScopeChips scope={row.scope} />,
    },
    {
      id: "period",
      header: "Период",
      width: "13rem",
      cell: (row) => promotionPeriodLabel(row.item),
    },
    {
      id: "percent",
      header: "Скидка",
      align: "end",
      width: "6rem",
      cell: (row) => `${String(row.item.percent)} %`,
    },
    {
      id: "usage",
      header: "Применения",
      align: "end",
      width: "9rem",
      cell: (row) => promotionUsageLabel(row.item),
    },
    {
      id: "state",
      header: "Состояние",
      width: "10rem",
      cell: (row) => <StateBadge state={promotionBadge(row.state)} />,
    },
  ];

  return (
    <section
      aria-labelledby={headingId}
      className="grid grid-cols-[minmax(0,1fr)] gap-4"
      data-promotions
    >
      <AdminListHeader
        action={filter.view === "promotions" ? createButton : undefined}
        headingId={headingId}
        title="Скидки"
      />
      <ViewSwitch
        onChange={(view) => {
          onFilterChange({ ...defaultPromotionsFilter, view });
        }}
        view={filter.view}
      />
      {filter.view === "questionnaire" ? (
        <QuestionnaireArchive />
      ) : (
        <>
          <AdminFilterBar
            chips={[
              ...(filter.productId === null
                ? []
                : [
                    {
                      id: "product",
                      label:
                        productName(filter.productId) ?? "Выбранный продукт",
                      onRemove: () => {
                        onFilterChange({ ...filter, productId: null });
                      },
                    },
                  ]),
              ...(filter.archived
                ? [
                    {
                      id: "archived",
                      label: "Архив",
                      onRemove: () => {
                        onFilterChange({ ...filter, archived: false });
                      },
                    },
                  ]
                : []),
            ]}
            filters={[
              {
                id: "product",
                label: "Продукт",
                value: filter.productId ?? allValue,
                options: [
                  { value: allValue, label: "Все продукты" },
                  ...(filter.productId !== null &&
                  productName(filter.productId) === undefined
                    ? [{ value: filter.productId, label: "Выбранный продукт" }]
                    : []),
                  ...choices.map((choice) => ({
                    value: choice.productId,
                    label: choice.name,
                  })),
                ],
                onChange: (value) => {
                  onFilterChange({
                    ...filter,
                    productId: value === allValue ? null : value,
                  });
                },
              },
              {
                id: "archived",
                label: "Записи",
                value: filter.archived ? "archived" : "current",
                options: [
                  { value: "current", label: "Действующие и будущие" },
                  { value: "archived", label: "Архив" },
                ],
                onChange: (value) => {
                  onFilterChange({ ...filter, archived: value === "archived" });
                },
              },
            ]}
            onReset={filtered ? reset : undefined}
          />
          <p aria-live="polite" className="text-sm empty:hidden" role="status">
            {status}
          </p>
          {list.isPending ? (
            <AdminTableSkeleton columns={7} label="Загружаем скидки" />
          ) : list.isError && rows.length === 0 ? (
            <AdminErrorState
              description="Список скидок не загрузился. Скидки при этом не изменились."
              onRetry={() => {
                void list.refetch();
              }}
              title="Не удалось загрузить скидки"
            />
          ) : rows.length === 0 && !list.hasNextPage ? (
            filtered ? (
              <AdminNoResults
                description="Под выбранные фильтры не подходит ни одна скидка."
                onReset={reset}
              />
            ) : (
              <AdminEmptyState
                action={createButton}
                description="Создайте скидку на один или несколько продуктов, с промокодом или без него."
                title="Скидок пока нет"
              />
            )
          ) : (
            <>
              <AdminTable
                busy={list.isFetching && !list.isFetchingNextPage}
                caption="Скидки"
                columns={columns}
                mobileItem={(row) => ({
                  title: row.item.name,
                  caption: `${scopeText(row.scope)} · ${promotionPeriodLabel(row.item)}`,
                  badge: <StateBadge state={promotionBadge(row.state)} />,
                  metric: `${String(row.item.percent)} %`,
                })}
                rowActions={(row) => (
                  <AdminRowMenu
                    items={[
                      {
                        id: "edit",
                        label: "Изменить",
                        disabled: !isPromotionEditable(row.item),
                        onSelect: () => {
                          setStatus("");
                          setDraft({
                            id: row.item.id,
                            initial: promotionFormFromItem(row.item),
                            origin: {
                              id: row.item.id,
                              revision: row.item.revision,
                              startsAt: row.item.startsAt,
                              endsAt: row.item.endsAt,
                            },
                          });
                        },
                      },
                      {
                        id: "archive",
                        label: "Архивировать",
                        tone: "danger",
                        disabled: !isPromotionEditable(row.item),
                        onSelect: () => {
                          setArchiveError(null);
                          setArchiving(row.item);
                        },
                      },
                    ]}
                    label={`Действия со скидкой «${row.item.name}»`}
                  />
                )}
                rowKey={(row) => row.item.id}
                rowTitle={(row) => row.item.name}
                rows={rows}
              />
              {list.isError ? (
                <AdminErrorState
                  description="Следующая страница не загрузилась. Уже показанные скидки остаются."
                  onRetry={() => {
                    void list.fetchNextPage();
                  }}
                  title="Не удалось загрузить продолжение"
                />
              ) : list.hasNextPage ? (
                <Button
                  className="min-h-11 justify-self-center px-4"
                  disabled={list.isFetchingNextPage}
                  onClick={() => {
                    void list.fetchNextPage();
                  }}
                  type="button"
                  variant="outline"
                >
                  {list.isFetchingNextPage ? "Загружаем…" : "Показать ещё"}
                </Button>
              ) : null}
            </>
          )}
        </>
      )}
      <PromotionFormDialog
        draft={draft}
        onClose={() => {
          setDraft(null);
        }}
        onRefresh={() => {
          setDraft(null);
          refresh();
        }}
        onSaved={(name, created) => {
          setDraft(null);
          setStatus(
            created
              ? `Скидка «${name}» создана.`
              : `Скидка «${name}» сохранена.`,
          );
          refresh();
        }}
        products={choices}
      />
      <AdminConfirmDialog
        confirmLabel="Архивировать скидку"
        consequence="Новые покупки её не получат. Сохранённые расчёты и оплаты не изменятся. Из архива скидку не вернуть: нужна новая."
        error={archiveError?.message ?? null}
        errorAction={
          archiveError?.conflict === true ? (
            <Button
              className="min-h-11 px-4"
              onClick={() => {
                setArchiving(null);
                refresh();
              }}
              type="button"
              variant="outline"
            >
              Обновить данные
            </Button>
          ) : undefined
        }
        onConfirm={() => {
          if (archiving === null) return;
          const input = {
            id: archiving.id,
            expectedRevision: archiving.revision,
          };
          setArchiveError(null);
          archive.mutate({
            ...input,
            operationId: repeat.operationId(`archive:${archiving.id}`, input),
          });
        }}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        open={archiving !== null}
        pending={archive.isPending}
        title={
          archiving === null
            ? "Архивировать скидку?"
            : `Архивировать «${archiving.name}»?`
        }
        tone="danger"
      />
    </section>
  );
}

function scopeText(scope: PromotionScope): string {
  switch (scope.kind) {
    case "all":
      return "Все продукты";
    case "legacy":
      return "Прежние предложения";
    case "products":
      return scope.names.join(", ");
  }
}

const shownChips = 2;

function ScopeChips({ scope }: { readonly scope: PromotionScope }) {
  if (scope.kind !== "products")
    return (
      <span
        className={
          scope.kind === "legacy" ? "text-muted-foreground" : undefined
        }
        data-scope={scope.kind}
      >
        {scopeText(scope)}
      </span>
    );
  const rest = scope.names.length - shownChips;
  return (
    <ul
      aria-label="Продукты скидки"
      className="admin-filter-chips"
      data-scope="products"
    >
      {scope.names.slice(0, shownChips).map((name, index) => (
        <li
          className="admin-filter-chip max-w-full truncate"
          key={`${name}-${String(index)}`}
        >
          {name}
        </li>
      ))}
      {rest > 0 ? (
        <li
          className="admin-filter-chip"
          title={scope.names.slice(shownChips).join(", ")}
        >
          ещё {rest}
        </li>
      ) : null}
    </ul>
  );
}

const views: readonly {
  readonly value: DiscountsView;
  readonly label: string;
}[] = [
  { value: "promotions", label: "Скидки" },
  { value: "questionnaire", label: "Анкетные скидки" },
];

/** Подразделы «Скидок»: выбор пишет адрес, поэтому «назад» возвращает прежний подраздел. */
function ViewSwitch({
  view,
  onChange,
}: {
  readonly view: DiscountsView;
  readonly onChange: (view: DiscountsView) => void;
}) {
  return (
    <nav aria-label="Подразделы скидок" className="flex flex-wrap gap-2">
      {views.map((option) => (
        <Button
          aria-current={option.value === view ? "page" : undefined}
          className="min-h-11 px-4"
          key={option.value}
          onClick={() => {
            if (option.value !== view) onChange(option.value);
          }}
          type="button"
          variant={option.value === view ? "secondary" : "ghost"}
        >
          {option.label}
        </Button>
      ))}
    </nav>
  );
}
