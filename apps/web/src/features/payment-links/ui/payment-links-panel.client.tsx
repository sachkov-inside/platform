"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  BillingReadError,
  isBillingRefusal,
  ownerPriceCatalogChanged,
  paymentLinkHref,
  paymentLinksQueryKey,
  productPriceChoices,
  useOwnerPriceCatalog,
  type PaymentLink,
  type ProductPriceChoice,
} from "@/entities/subscription";
import { internalRoute } from "@/shared/routing/internal-route";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { formatMoscowDate, formatRubles } from "@/shared/lib/moscow-format";
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
  adminStates,
  type AdminTableColumn,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import {
  listPaymentLinks,
  revokePaymentLink,
} from "../api/payment-links.browser";
import {
  announcePaymentLinkChange,
  subscribePaymentLinkChange,
} from "../model/payment-link-events";
import { paymentLinkExpiryLabel } from "../model/payment-link-expiry";
import {
  allPaymentLinks,
  canRevokePaymentLink,
  paymentLinkBadge,
  paymentLinkStates,
  paymentLinkTitle,
  revokeFailureMessage,
  type PaymentLinksFilter,
} from "../model/payment-links-presentation";
import {
  PaymentLinkCreateDialog,
  type ProductChoicesState,
} from "./payment-link-create-dialog.client";
import { PaymentLinkDetailsDialog } from "./payment-link-details-dialog.client";
import { copyPaymentLink, paymentLinkUrl } from "./payment-link-share.client";

const pageSize = 30;
const allValue = "all";
const headingId = "payment-links-heading";

export interface PaymentLinksPanelProps {
  /**
   * Продукт страницы продукта: список и создание закреплены за ним, выбора продукта нет. Без него
   * панель сама становится страницей «Ссылки на оплату» с выбором продукта.
   */
  readonly productId?: string;
  /** Фильтр из адреса страницы. Без него панель держит фильтр сама. */
  readonly filter?: PaymentLinksFilter;
  readonly onFilterChange?: (filter: PaymentLinksFilter) => void;
}

/**
 * Ссылки на оплату: список от новых к старым с фильтрами, создание в листе или диалоге и отзыв
 * из «⋯» с подтверждением. Без `productId` это содержимое страницы с заголовком первого уровня;
 * с ним раздел вкладки «Продажа» продукта.
 */
export function PaymentLinksPanel({
  productId,
  filter: requestedFilter,
  onFilterChange,
}: PaymentLinksPanelProps) {
  const cache = useQueryClient();
  const [ownFilter, setOwnFilter] = useState(allPaymentLinks);
  const baseFilter = requestedFilter ?? ownFilter;
  const filter: PaymentLinksFilter =
    productId === undefined ? baseFilter : { ...baseFilter, productId };
  const changeFilter = (next: PaymentLinksFilter) => {
    if (onFilterChange === undefined) setOwnFilter(next);
    else onFilterChange(next);
  };
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<PaymentLink | null>(null);
  const [opened, setOpened] = useState<PaymentLink | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeConflict, setRevokeConflict] = useState(false);
  const [status, setStatus] = useState("");
  const repeat = useRepeatableOperations();
  // Своё объявление уже перечитало список здесь: подписка его пропускает.
  const ownAnnouncement = useRef<string | null>(null);

  const catalog = useOwnerPriceCatalog();
  const choices: readonly ProductPriceChoice[] =
    catalog.data === undefined ? [] : productPriceChoices(catalog.data.items);
  const products: ProductChoicesState = catalog.isSuccess
    ? { kind: "ready", choices }
    : catalog.isError
      ? {
          kind: "unavailable",
          onRetry: () => {
            void catalog.refetch();
          },
        }
      : { kind: "pending" };

  const list = useInfiniteQuery({
    queryKey: [...paymentLinksQueryKey, filter.productId, filter.state],
    // Отказ и недоступность показываются сразу, с кнопкой повтора: чтение не повторяется молча.
    retry: false,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listPaymentLinks({
        operationId: crypto.randomUUID(),
        limit: pageSize,
        ...(filter.productId === null ? {} : { productId: filter.productId }),
        ...(filter.state === null ? {} : { state: filter.state }),
        ...(pageParam === null ? {} : { cursor: pageParam }),
      });
      if (!result.ok) throw new BillingReadError(result.code);
      return result.value.result;
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: paymentLinksQueryKey });
  };
  const announce = () => {
    ownAnnouncement.current = announcePaymentLinkChange();
    refresh();
  };
  useEffect(
    () =>
      subscribePaymentLinkChange((announcementId) => {
        if (announcementId === ownAnnouncement.current) return;
        void cache.invalidateQueries({ queryKey: paymentLinksQueryKey });
      }),
    [cache],
  );
  // Новая ревизия цены продукта меняет состояние его ссылок («Цена изменилась»).
  useEffect(
    () =>
      ownerPriceCatalogChanged.subscribe(() => {
        void cache.invalidateQueries(
          { queryKey: paymentLinksQueryKey },
          { cancelRefetch: false },
        );
      }),
    [cache],
  );

  const revoke = useMutation({
    mutationFn: revokePaymentLink,
    retry: false,
    onError: () => {
      setRevokeError(
        "Ответ не получен. Повторите: повтор не отзовёт ссылку дважды.",
      );
    },
    onSuccess: (result, input) => {
      if (!result.ok) {
        setRevokeError(revokeFailureMessage(result.code));
        setRevokeConflict(result.code === "revision_conflict");
        return;
      }
      repeat.completeOperation(`revoke:${input.id}`);
      setRevoking(null);
      setRevokeError(null);
      setStatus("Ссылка отозвана. Оплатить по ней больше нельзя.");
      announce();
    },
  });

  const links = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered =
    (productId === undefined && filter.productId !== null) ||
    filter.state !== null;
  const productName = (id: string) =>
    choices.find((choice) => choice.productId === id)?.name ??
    "Выбранный продукт";
  const pageMode = productId === undefined;
  // Без права billing:manage повтор не поможет: отказ без повтора, фильтров и создания.
  const refused =
    isBillingRefusal(list.error) || isBillingRefusal(catalog.error);
  const createButton = refused ? undefined : (
    <Button
      className="min-h-11 px-4"
      onClick={() => {
        setStatus("");
        setCreating(true);
      }}
      type="button"
    >
      <Plus aria-hidden="true" data-icon="inline-start" />
      Создать ссылку
    </Button>
  );

  const columns: readonly AdminTableColumn<PaymentLink>[] = [
    {
      id: "product",
      header: "Продукт",
      cell: (link) => `Создана ${formatMoscowDate(link.createdAt)}`,
    },
    {
      id: "state",
      header: "Состояние",
      width: "11rem",
      cell: (link) => <StateBadge state={paymentLinkBadge(link.state)} />,
    },
    {
      id: "price",
      header: "Цена",
      align: "end",
      width: "9rem",
      cell: (link) => formatRubles(link.snapshot.firstPriceKopecks),
    },
    {
      id: "expiry",
      header: "Срок",
      width: "10rem",
      cell: (link) => paymentLinkExpiryLabel(link.expiresAt),
    },
  ];

  return (
    <section
      aria-labelledby={headingId}
      className="grid grid-cols-[minmax(0,1fr)] gap-4"
      data-payment-links
    >
      {pageMode ? (
        <AdminListHeader
          action={createButton}
          count="Новые сверху"
          headingId={headingId}
          title="Ссылки на оплату"
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            className="text-lg font-semibold tracking-[-0.02em]"
            id={headingId}
          >
            Ссылки на оплату
          </h2>
          {createButton}
        </div>
      )}
      {refused ? null : (
        <AdminFilterBar
          chips={[
            ...(pageMode && filter.productId !== null
              ? [
                  {
                    id: "product",
                    label: productName(filter.productId),
                    onRemove: () => {
                      changeFilter({ ...filter, productId: null });
                    },
                  },
                ]
              : []),
            ...(filter.state === null
              ? []
              : [
                  {
                    id: "state",
                    label: adminStates[paymentLinkBadge(filter.state)].label,
                    onRemove: () => {
                      changeFilter({ ...filter, state: null });
                    },
                  },
                ]),
          ]}
          filters={[
            ...(pageMode
              ? [
                  {
                    id: "product",
                    label: "Продукт",
                    value: filter.productId ?? allValue,
                    options: [
                      { value: allValue, label: "Все продукты" },
                      ...withSelectedProduct(choices, filter.productId).map(
                        (choice) => ({
                          value: choice.value,
                          label: choice.label,
                        }),
                      ),
                    ],
                    onChange: (value: string) => {
                      changeFilter({
                        ...filter,
                        productId: value === allValue ? null : value,
                      });
                    },
                  },
                ]
              : []),
            {
              id: "state",
              label: "Состояние",
              value: filter.state ?? allValue,
              options: [
                { value: allValue, label: "Все состояния" },
                ...paymentLinkStates.map((state) => ({
                  value: state,
                  label: adminStates[paymentLinkBadge(state)].label,
                })),
              ],
              onChange: (value: string) => {
                changeFilter({
                  ...filter,
                  state:
                    paymentLinkStates.find((state) => state === value) ?? null,
                });
              },
            },
          ]}
          onReset={
            filtered
              ? () => {
                  changeFilter({ ...allPaymentLinks });
                }
              : undefined
          }
        />
      )}
      <p aria-live="polite" className="text-sm empty:hidden" role="status">
        {status}
      </p>
      {refused ? (
        <AdminEmptyState
          description="Ссылки на оплату видит и создаёт владелец с правом управлять оплатой. Если оно нужно вам, попросите владельца его выдать."
          title="Нет права на ссылки на оплату"
        />
      ) : list.isPending ? (
        <AdminTableSkeleton columns={5} label="Загружаем ссылки" />
      ) : list.isError && links.length === 0 ? (
        <AdminErrorState
          description="Список ссылок не загрузился. Ссылки при этом не изменились."
          onRetry={() => {
            void list.refetch();
          }}
          title="Не удалось загрузить ссылки"
        />
      ) : links.length === 0 && !list.hasNextPage ? (
        filtered ? (
          <AdminNoResults
            description="Под выбранные фильтры не подходит ни одна ссылка."
            onReset={() => {
              changeFilter({ ...allPaymentLinks });
            }}
          />
        ) : (
          <AdminEmptyState
            action={createButton}
            description="Создайте ссылку с согласованной ценой и отправьте её покупателю. Публичная цена продукта не изменится."
            title="Ссылок на оплату пока нет"
          />
        )
      ) : (
        <>
          <AdminTable
            busy={list.isFetching && !list.isFetchingNextPage}
            caption="Ссылки на оплату, новые сверху"
            columns={columns}
            mobileItem={(link) => ({
              title: paymentLinkTitle(link),
              caption: paymentLinkExpiryLabel(link.expiresAt),
              badge: <StateBadge state={paymentLinkBadge(link.state)} />,
              metric: formatRubles(link.snapshot.firstPriceKopecks),
            })}
            rowActions={(link) => (
              <AdminRowMenu
                items={[
                  {
                    id: "copy",
                    label: "Скопировать ссылку",
                    onSelect: () => {
                      void copyPaymentLink(paymentLinkUrl(link.id)).then(
                        setStatus,
                      );
                    },
                  },
                  {
                    id: "open",
                    label: "Открыть оформление",
                    href: internalRoute(paymentLinkHref(link.id)),
                  },
                  {
                    id: "revoke",
                    label: "Отозвать",
                    tone: "danger",
                    disabled: !canRevokePaymentLink(link),
                    onSelect: () => {
                      setRevokeError(null);
                      setRevokeConflict(false);
                      setRevoking(link);
                    },
                  },
                ]}
                label={`Действия со ссылкой «${paymentLinkTitle(link)}» от ${formatMoscowDate(link.createdAt)}`}
              />
            )}
            onRowOpen={(link) => {
              setStatus("");
              setOpened(link);
            }}
            rowKey={(link) => link.id}
            rowTitle={(link) => paymentLinkTitle(link)}
            rows={links}
          />
          {list.isError ? (
            <AdminErrorState
              description="Следующая страница не загрузилась. Уже показанные ссылки остаются."
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
      <PaymentLinkCreateDialog
        fixedProductId={productId}
        onCreated={() => {
          announce();
        }}
        onOpenChange={setCreating}
        open={creating}
        products={products}
      />
      <PaymentLinkDetailsDialog
        // Подробности показывают последнее прочитанное состояние ссылки, а не снимок щелчка.
        link={
          opened === null
            ? null
            : (links.find((link) => link.id === opened.id) ?? opened)
        }
        onClose={() => {
          setOpened(null);
        }}
      />
      <AdminConfirmDialog
        confirmLabel="Отозвать ссылку"
        consequence={
          revoking === null
            ? undefined
            : `Оплатить по ссылке будет нельзя. Цена ${formatRubles(revoking.snapshot.firstPriceKopecks)}, ${paymentLinkExpiryLabel(revoking.expiresAt).toLocaleLowerCase("ru")}. Покупатель увидит, что ссылка отозвана.`
        }
        error={revokeError}
        errorAction={
          revokeConflict ? (
            <Button
              className="min-h-11 px-4"
              onClick={() => {
                setRevoking(null);
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
          if (revoking === null) return;
          const input = {
            id: revoking.id,
            expectedRevision: revoking.revision,
          };
          setRevokeError(null);
          revoke.mutate({
            ...input,
            operationId: repeat.operationId(`revoke:${revoking.id}`, input),
          });
        }}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        open={revoking !== null}
        pending={revoke.isPending}
        title={
          revoking === null
            ? "Отозвать ссылку?"
            : `Отозвать ссылку на «${paymentLinkTitle(revoking)}»?`
        }
        tone="danger"
      />
    </section>
  );
}

/** Выбранный в адресе продукт остаётся в списке выбора, даже если его цену сняли с продажи. */
function withSelectedProduct(
  choices: readonly ProductPriceChoice[],
  selected: string | null,
): readonly { readonly value: string; readonly label: string }[] {
  const options = choices.map((choice) => ({
    value: choice.productId,
    label: choice.name,
  }));
  return selected === null ||
    options.some((option) => option.value === selected)
    ? options
    : [{ value: selected, label: "Выбранный продукт" }, ...options];
}
