"use client";

import { Info } from "lucide-react";

import { accessOriginLabels, personLabel } from "@/entities/authoring-person";
import {
  accessProductLabel,
  type AccessProductCatalogView,
} from "@/features/product-access-actions";
import {
  formatCountRu,
  formatMoscowDate,
  formatMoscowDateTime,
} from "@/shared/lib/moscow-format";
import { authoringPersonHref } from "@/shared/routing/authoring";
import {
  AdminCursorPagination,
  AdminEmptyState,
  AdminErrorState,
  AdminFilterBar,
  AdminListHeader,
  AdminNoResults,
  AdminRowMenu,
  AdminTable,
  StateBadge,
  type AdminRowMenuItem,
  type AdminTableColumn,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import {
  accessStateFilterLabels,
  hasPeopleListFilters,
  PEOPLE_NAME_MATCH_LIMIT,
  peopleFilterChips,
  peopleListHref,
  resetPeopleListQuery,
  withPeopleListFilter,
  type PeopleListQuery,
  type PeopleListState,
  type PersonRow,
} from "../model/people-list";
import { AuthoringPeopleFrame } from "./authoring-people-frame";

const headingId = "authoring-people-heading";
const peopleForms = ["человек", "человека", "человек"] as const;
const allValue = "all";
/** Столько продуктов строка показывает поимённо; остальные считаются числом. */
const shownProducts = 3;

export interface AuthoringPeopleViewProps {
  readonly catalog: AccessProductCatalogView;
  readonly isRefreshing?: boolean;
  readonly onQueryChange: (query: PeopleListQuery) => void;
  readonly onRetry: () => void;
  readonly query: PeopleListQuery;
  readonly state: PeopleListState;
}

/**
 * Список людей (#1721) в общем образце: заголовок с числом, поиск и три фильтра с плашками,
 * таблица «Человек, Продукты, Регистрация, Последняя активность» и курсорный вывод. Строка
 * открывает карточку человека.
 */
export function AuthoringPeopleView({
  catalog,
  isRefreshing = false,
  onQueryChange,
  onRetry,
  query,
  state,
}: AuthoringPeopleViewProps) {
  if (state.kind === "invalid_query")
    return <PeopleQueryRefused onQueryChange={onQueryChange} query={query} />;
  if (state.kind !== "ready")
    return <AuthoringPeopleFailure onRetry={onRetry} state={state} />;
  const filtered = hasPeopleListFilters(query);
  const firstUse = state.total === 0 && !filtered && query.cursor === undefined;
  const truncated = state.nameSearch === "truncated";
  // При обрезанном поиске по имени `total` считает только показанные совпадения: число
  // называется как нижняя граница, а не как итог.
  const count = truncated
    ? `Больше ${formatCountRu(PEOPLE_NAME_MATCH_LIMIT, peopleForms)}`
    : formatCountRu(state.total, peopleForms);
  return (
    <AuthoringPeopleFrame busy={isRefreshing} labelledBy={headingId}>
      <AdminListHeader count={count} headingId={headingId} title="Люди" />
      <section
        aria-label="Список людей"
        className="grid grid-cols-[minmax(0,1fr)] gap-4"
        data-authoring-people-list
      >
        {firstUse ? (
          <AdminEmptyState
            description="Человек появится здесь, когда войдёт через Telegram, подтвердит email или оплатит продукт."
            title="Людей пока нет"
          />
        ) : (
          <>
            <PeopleFilters
              catalog={catalog}
              count={count}
              onQueryChange={onQueryChange}
              query={query}
            />
            {state.nameSearch === "unavailable" ? (
              <NameSearchUnavailable />
            ) : null}
            {truncated ? <NameSearchTruncated /> : null}
            <PeopleRows
              isRefreshing={isRefreshing}
              onQueryChange={onQueryChange}
              query={query}
              state={state}
            />
          </>
        )}
      </section>
    </AuthoringPeopleFrame>
  );
}

function catalogName(catalog: AccessProductCatalogView, productId: string) {
  if (catalog.kind !== "ready") return "Выбранный продукт";
  const product = catalog.products.find(
    (entry) => entry.productId === productId,
  );
  return product === undefined
    ? "Выбранный продукт"
    : accessProductLabel(product);
}

function PeopleFilters({
  catalog,
  count,
  onQueryChange,
  query,
}: {
  readonly catalog: AccessProductCatalogView;
  /** «12 человек» или «Больше 50 человек», если поиск по имени обрезан. */
  readonly count: string;
  readonly onQueryChange: (query: PeopleListQuery) => void;
  readonly query: PeopleListQuery;
}) {
  const filtered = hasPeopleListFilters(query);
  const products =
    catalog.kind === "ready"
      ? catalog.products.map((product) => ({
          label: accessProductLabel(product),
          value: product.productId,
        }))
      : [];
  const selectedProduct =
    query.productId !== undefined &&
    !products.some((option) => option.value === query.productId)
      ? [
          {
            label: catalogName(catalog, query.productId),
            value: query.productId,
          },
        ]
      : [];
  return (
    <AdminFilterBar
      chips={peopleFilterChips(query, (productId) =>
        catalogName(catalog, productId),
      ).map((chip) => ({
        id: chip.id,
        label: chip.label,
        onRemove: () => {
          onQueryChange(chip.next);
        },
      }))}
      filters={[
        {
          id: "product",
          label: "Продукт",
          onChange: (value) => {
            onQueryChange(
              withPeopleListFilter(
                query,
                "productId",
                value === allValue ? undefined : value,
              ),
            );
          },
          options: [
            { label: "Все продукты", value: allValue },
            ...products,
            ...selectedProduct,
          ],
          value: query.productId ?? allValue,
        },
        {
          id: "origin",
          label: "Способ получения",
          onChange: (value) => {
            onQueryChange(
              withPeopleListFilter(
                query,
                "origin",
                value === allValue ? undefined : value,
              ),
            );
          },
          options: [
            { label: "Любой способ", value: allValue },
            ...Object.entries(accessOriginLabels).map(([value, label]) => ({
              label,
              value,
            })),
          ],
          value: query.origin ?? allValue,
        },
        {
          id: "state",
          label: "Состояние доступа",
          onChange: (value) => {
            onQueryChange(
              withPeopleListFilter(
                query,
                "state",
                value === allValue ? undefined : value,
              ),
            );
          },
          options: [
            { label: "Любое состояние", value: allValue },
            ...Object.entries(accessStateFilterLabels).map(
              ([value, label]) => ({
                label,
                value,
              }),
            ),
          ],
          value: query.state ?? allValue,
        },
      ]}
      onReset={
        filtered
          ? () => {
              onQueryChange(resetPeopleListQuery);
            }
          : undefined
      }
      resultLabel={filtered ? `Найдено: ${count}` : undefined}
      search={{
        label: "Поиск по имени, @username, email или ID",
        maxLength: 160,
        onChange: (value) => {
          onQueryChange(withPeopleListFilter(query, "search", value));
        },
        placeholder: "Имя, @username, email или ID",
        value: query.search ?? "",
      }}
    />
  );
}

/** Совпадений по имени больше предела: показаны первые, запрос стоит уточнить. */
function NameSearchTruncated() {
  return (
    <p
      className="flex gap-2 rounded-xl border border-border bg-secondary p-3 text-sm"
      role="status"
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      Совпадений по имени больше {PEOPLE_NAME_MATCH_LIMIT}, показаны первые.
      Уточните запрос.
    </p>
  );
}

/** Поиск по имени не ответил: пустой список тогда не значит «никого нет». */
function NameSearchUnavailable() {
  return (
    <p
      className="flex gap-2 rounded-xl border border-border bg-secondary p-3 text-sm"
      role="status"
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      Поиск по имени и @username временно недоступен: Telegram сейчас не
      отвечает. Поиск по email и ID работает.
    </p>
  );
}

function PeopleRows({
  isRefreshing,
  onQueryChange,
  query,
  state,
}: {
  readonly isRefreshing: boolean;
  readonly onQueryChange: (query: PeopleListQuery) => void;
  readonly query: PeopleListQuery;
  readonly state: Extract<PeopleListState, { readonly kind: "ready" }>;
}) {
  const { cursor, ...firstPage } = query;
  const firstPageHref = cursor === undefined ? null : peopleListHref(firstPage);
  const pagination = (
    <AdminCursorPagination
      label="Страницы списка людей"
      newerHref={firstPageHref}
      newerLabel="К началу списка"
      olderHref={
        state.nextCursor === null
          ? null
          : peopleListHref({ ...query, cursor: state.nextCursor })
      }
      olderLabel="Дальше"
    />
  );
  if (state.items.length === 0) {
    if (state.nameSearch === "unavailable") return null;
    if (state.nextCursor !== null || cursor !== undefined)
      return (
        <>
          <AdminNoResults
            description={
              state.nextCursor === null
                ? "Список стал короче, пока открывали эту страницу."
                : "Дальше в списке ещё есть люди."
            }
            title="На этой странице людей нет"
          />
          {pagination}
        </>
      );
    return (
      <AdminNoResults
        description="Измените запрос или сбросьте фильтры, чтобы увидеть всех людей."
        onReset={() => {
          onQueryChange(resetPeopleListQuery);
        }}
        title="Никого не нашли"
      />
    );
  }
  return (
    <>
      <AdminTable
        busy={isRefreshing}
        caption="Люди, новые сверху"
        columns={columns}
        mobileItem={(row) => ({
          caption: productsLine(row),
          metric: (
            <time dateTime={row.registeredAt}>
              С {formatMoscowDate(row.registeredAt)}
            </time>
          ),
          title: rowTitle(row),
        })}
        rowActions={(row) => (
          <AdminRowMenu
            items={menuItems(row)}
            label={`Действия с «${rowTitle(row)}»`}
          />
        )}
        rowHref={(row) => authoringPersonHref(row.accountId)}
        rowKey={(row) => row.accountId}
        rowTitle={rowTitle}
        rows={state.items}
      />
      {pagination}
    </>
  );
}

function rowTitle(row: PersonRow): string {
  const label = personLabel(row);
  return label.title ?? label.missing;
}

/** Подстрока человека: что не попало в заголовок, и отсутствие связи с Telegram. */
function personCaption(row: PersonRow): string {
  const label = personLabel(row);
  return [
    ...label.context,
    ...(row.telegram === "not_linked" ? ["Telegram не связан"] : []),
  ].join(" · ");
}

function productsLine(row: PersonRow): string {
  if (row.products.length === 0) return "Без продуктов";
  return row.products
    .map((product) =>
      product.access === "revoked" ? `${product.name} (отозван)` : product.name,
    )
    .join(", ");
}

function ProductsCell({ row }: { readonly row: PersonRow }) {
  if (row.products.length === 0)
    return <span className="text-muted-foreground">Без продуктов</span>;
  const shown = row.products.slice(0, shownProducts);
  const rest = row.products.length - shown.length;
  return (
    <ul className="grid gap-1">
      {shown.map((product) => (
        <li
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
          key={product.productId}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {product.name}
          </span>
          {product.access === "revoked" ? (
            <StateBadge state="access.revoked" />
          ) : (
            <span className="sr-only">, доступ открыт</span>
          )}
        </li>
      ))}
      {rest > 0 ? (
        <li className="text-muted-foreground">и ещё {rest}</li>
      ) : null}
    </ul>
  );
}

const columns: readonly AdminTableColumn<PersonRow>[] = [
  { cell: personCaption, header: "Человек", id: "person" },
  {
    cell: (row) => <ProductsCell row={row} />,
    header: "Продукты",
    id: "products",
    width: "30%",
  },
  {
    cell: (row) => (
      <time className="tabular-nums" dateTime={row.registeredAt}>
        {formatMoscowDate(row.registeredAt)}
      </time>
    ),
    header: "Регистрация",
    id: "registeredAt",
    width: "9rem",
  },
  {
    cell: (row) =>
      row.lastActivityAt === null ? (
        <span className="text-muted-foreground">Не было</span>
      ) : (
        <time className="tabular-nums" dateTime={row.lastActivityAt}>
          {formatMoscowDateTime(row.lastActivityAt)}
        </time>
      ),
    header: "Последняя активность",
    id: "lastActivityAt",
    width: "11.5rem",
  },
];

function menuItems(row: PersonRow): AdminRowMenuItem[] {
  return [
    {
      href: authoringPersonHref(row.accountId),
      id: "open",
      label: "Открыть карточку",
    },
    {
      id: "copy-id",
      label: "Скопировать ID",
      onSelect: () => {
        void navigator.clipboard
          .writeText(row.accountId)
          .catch(() => undefined);
      },
    },
  ];
}

/**
 * Nest отказал запросу списка (400). С курсором это устаревшая страница: список начинается
 * заново с теми же фильтрами. Без курсора не так сам запрос, и сбрасываются фильтры.
 */
function PeopleQueryRefused({
  onQueryChange,
  query,
}: {
  readonly onQueryChange: (query: PeopleListQuery) => void;
  readonly query: PeopleListQuery;
}) {
  const { cursor, ...firstPage } = query;
  const stalePage = cursor !== undefined;
  return (
    <AuthoringPeopleFrame labelledBy={headingId}>
      <AdminListHeader headingId={headingId} title="Люди" />
      <AdminNoResults
        description={
          stalePage
            ? "Список изменился или ссылка неполная, поэтому эту страницу уже не показать. Откройте список с первой страницы: фильтры сохранятся."
            : "Сервер не принял этот запрос. Сбросьте поиск и фильтры, чтобы увидеть всех людей."
        }
        onReset={() => {
          onQueryChange(stalePage ? firstPage : resetPeopleListQuery);
        }}
        resetLabel={stalePage ? "К началу списка" : "Сбросить фильтры"}
        title={stalePage ? "Страница списка устарела" : "Запрос не принят"}
      />
    </AuthoringPeopleFrame>
  );
}

function AuthoringPeopleFailure({
  onRetry,
  state,
}: {
  readonly onRetry: () => void;
  readonly state: Exclude<
    PeopleListState,
    { readonly kind: "ready" | "invalid_query" }
  >;
}) {
  const view =
    state.kind === "signed_out"
      ? {
          description: "Войдите под аккаунтом владельца, чтобы увидеть людей.",
          title: "Нужен вход",
        }
      : state.kind === "forbidden"
        ? {
            description:
              "Список людей открыт аккаунту с правом управлять доступом и оплатами.",
            title: "Нет доступа к людям",
          }
        : {
            description:
              "Список людей временно недоступен. Доступы не изменились, повторите чтение.",
            title: "Не удалось открыть список",
          };
  return (
    <AuthoringPeopleFrame labelledBy={headingId}>
      <AdminListHeader headingId={headingId} title="Люди" />
      <AdminErrorState
        description={view.description}
        {...(state.kind === "unavailable"
          ? { reference: state.reference }
          : {})}
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
    </AuthoringPeopleFrame>
  );
}
