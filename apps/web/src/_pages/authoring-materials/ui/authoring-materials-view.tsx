import {
  ArrowLeft,
  ArrowRight,
  CloudOff,
  Eye,
  FilePenLine,
  FilePlus2,
  FilterX,
  LibraryBig,
  LockKeyhole,
  Search,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";

import { materialTaxonomyLabel } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";

import type {
  AuthoringMaterialListItem,
  AuthoringMaterialsQuery,
  AuthoringMaterialsState,
} from "../model/authoring-materials-presentation";
import {
  authoringDestinationHref,
  authoringMaterialsHref,
  authoringMaterialsRootHref,
} from "../model/authoring-materials-query";
import {
  AuthoringMaterialActions,
} from "./authoring-material-actions.client";

export function AuthoringMaterialsView({
  isRefreshing = false,
  onQueryChange,
  onRetry,
  query,
  state,
}: {
  readonly isRefreshing?: boolean;
  readonly onQueryChange?: (query: AuthoringMaterialsQuery) => void;
  readonly onRetry?: () => void;
  readonly query: AuthoringMaterialsQuery;
  readonly state: AuthoringMaterialsState;
}) {
  const returnHref = authoringMaterialsHref(query);
  if (state.kind !== "ready") {
    return (
      <AuthoringMaterialsStateView
        {...(onRetry === undefined ? {} : { onRetry })}
        query={query}
        state={state}
      />
    );
  }
  return (
    <>
      <main
        aria-busy={isRefreshing}
        aria-labelledby="authoring-materials-heading"
        className="h-full min-h-svh overflow-y-auto bg-background text-foreground md:min-h-0 md:overscroll-y-contain"
        id="authoring-content"
        tabIndex={-1}
      >
        <div className="mx-auto w-full max-w-[76rem] px-4 py-7 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
          <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1
                className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl"
                id="authoring-materials-heading"
              >
                Материалы
              </h1>
            </div>
            <Button asChild className="min-h-11 shrink-0 sm:self-center">
              <Link href={authoringDestinationHref("/authoring/materials/new", returnHref)}>
                <FilePlus2 aria-hidden="true" data-icon="inline-start" />
                Новый материал
              </Link>
            </Button>
          </header>

          <AuthoringMaterialsFilters
            {...(onQueryChange === undefined ? {} : { onQueryChange })}
            query={query}
            totalItems={state.totalItems}
          />
          <AuthoringMaterialsResults
            {...(onQueryChange === undefined ? {} : { onQueryChange })}
            query={query}
            returnHref={returnHref}
            state={state}
          />
        </div>
      </main>
    </>
  );
}

function AuthoringMaterialsFilters({
  onQueryChange,
  query,
  totalItems,
}: {
  readonly onQueryChange?: (query: AuthoringMaterialsQuery) => void;
  readonly query: AuthoringMaterialsQuery;
  readonly totalItems: number;
}) {
  const hasFilters = query.search !== undefined || query.publicationState !== undefined;
  return (
    <section aria-labelledby="authoring-materials-filter-heading" className="py-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold" id="authoring-materials-filter-heading">
          Найти материал
        </h2>
        <p aria-live="polite" className="font-mono text-xs text-muted-foreground">
          {formatMaterialCount(totalItems)}
        </p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(16rem,1fr)_13rem_auto]">
        <label className="relative block">
          <span className="sr-only">Поиск по названию, описанию или адресу</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoComplete="off"
            className="min-h-11 w-full rounded-xl border border-input bg-card py-2 pl-10 pr-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 sm:text-sm"
            onChange={(event) => {
              onQueryChange?.(withMaterialSearch(query, event.currentTarget.value));
            }}
            maxLength={160}
            name="search"
            placeholder="Название, описание или адрес"
            type="search"
            value={query.search ?? ""}
          />
        </label>
        <Select
          onValueChange={(value) => {
            onQueryChange?.(withPublicationState(query, value));
          }}
          value={query.publicationState ?? "all"}
        >
          <SelectTrigger aria-label="Состояние публикации" className="bg-card text-base sm:text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все состояния</SelectItem>
            <SelectItem value="draft">Черновики</SelectItem>
            <SelectItem value="published">Опубликованные</SelectItem>
            <SelectItem value="unpublished">Снятые с публикации</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters ? (
          onQueryChange === undefined ? (
            <Button asChild className="size-11" size="icon-lg" variant="ghost">
              <Link aria-label="Сбросить поиск и фильтр" href={authoringMaterialsRootHref}>
                <FilterX aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button
              aria-label="Сбросить поиск и фильтр"
              className="size-11"
              onClick={() => {
                onQueryChange({ page: 1 });
              }}
              size="icon-lg"
              type="button"
              variant="ghost"
            >
              <FilterX aria-hidden="true" />
            </Button>
          )
        ) : null}
      </div>
    </section>
  );
}

function AuthoringMaterialsResults({
  onQueryChange,
  query,
  returnHref,
  state,
}: {
  readonly onQueryChange?: (query: AuthoringMaterialsQuery) => void;
  readonly query: AuthoringMaterialsQuery;
  readonly returnHref: Route;
  readonly state: Extract<AuthoringMaterialsState, { readonly kind: "ready" }>;
}) {
  if (state.items.length === 0) {
    const hasFilters = query.search !== undefined || query.publicationState !== undefined;
    const missingPage = state.totalItems > 0;
    return (
      <section className="border-y border-border py-12 text-center">
        <LibraryBig aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em]">
          {missingPage
            ? "На этой странице больше нет материалов"
            : hasFilters
              ? "Материалы не найдены"
              : "Первый материал ещё не создан"}
        </h2>
        <p className="mx-auto mt-2 max-w-[52ch] text-sm leading-6 text-muted-foreground">
          {missingPage
            ? "Вернитесь к началу списка: состав материалов мог измениться."
            : hasFilters
              ? "Измените запрос или сбросьте фильтр, чтобы увидеть все материалы."
              : "Создайте черновик — он сразу появится в списке."}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {missingPage || hasFilters ? (
            <Button asChild variant="outline">
              <Link href={authoringMaterialsRootHref}>Показать все</Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href={authoringDestinationHref("/authoring/materials/new", returnHref)}>
                Создать материал
              </Link>
            </Button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="authoring-materials-list-heading">
      <h2 className="sr-only" id="authoring-materials-list-heading">
        Список материалов
      </h2>
      <ul className="divide-y divide-border border-y border-border">
        {state.items.map((material) => (
          <AuthoringMaterialRow
            key={material.materialId}
            material={material}
            returnHref={returnHref}
          />
        ))}
      </ul>
      <AuthoringMaterialsPagination
        {...(onQueryChange === undefined ? {} : { onQueryChange })}
        query={query}
        state={state}
      />
    </section>
  );
}

function AuthoringMaterialRow({
  material,
  returnHref,
}: {
  readonly material: AuthoringMaterialListItem;
  readonly returnHref: Route;
}) {
  const editorPath = `/authoring/materials/${material.materialId}`;
  const title = material.title ?? "Черновик без названия";
  return (
    <li className="group grid gap-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:py-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <PublicationState state={material.publicationState} />
        </div>
        <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] sm:text-xl">
          <Link
            className="rounded-sm text-foreground no-underline outline-none group-hover:underline group-hover:decoration-accent group-hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/30"
            href={authoringDestinationHref(editorPath, returnHref)}
          >
            {title}
          </Link>
        </h3>
        {material.title === null ? (
          <p className="mt-1 truncate font-mono text-[0.6875rem] text-muted-foreground">
            {material.materialId}
          </p>
        ) : null}
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <MaterialFact label="Тема" value={localizedTaxonomyValue(material.topic)} />
          <MaterialFact label="Формат" value={localizedTaxonomyValue(material.format)} />
          <div>
            <dt className="sr-only">Последнее изменение</dt>
            <dd>
              <time dateTime={material.updatedAt} title={material.updatedAt}>
                Изменён {formatUpdatedAt(material.updatedAt)}
              </time>
            </dd>
          </div>
        </dl>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:max-w-[36rem] sm:flex-wrap sm:justify-end">
        <Button asChild className="min-h-11" variant="outline">
          <Link href={authoringDestinationHref(editorPath, returnHref)}>
            <FilePenLine aria-hidden="true" data-icon="inline-start" />
            Редактировать
          </Link>
        </Button>
        <Button asChild className="min-h-11" variant="ghost">
          <Link href={authoringDestinationHref(`${editorPath}/preview`, returnHref)}>
            <Eye aria-hidden="true" data-icon="inline-start" />
            Предпросмотр
          </Link>
        </Button>
        <AuthoringMaterialActions
          editorHref={authoringDestinationHref(editorPath, returnHref)}
          material={material}
        />
      </div>
    </li>
  );
}

function MaterialFact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="inline-flex min-h-7 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xs font-medium text-foreground">{value}</dd>
    </div>
  );
}

function PublicationState({
  state,
}: {
  readonly state: AuthoringMaterialListItem["publicationState"];
}) {
  const label =
    state === "draft"
      ? "Черновик"
      : state === "published"
        ? "Опубликован"
        : "Снят с публикации";
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold",
        state === "published"
          ? "bg-secondary text-foreground"
          : state === "unpublished"
            ? "bg-muted text-muted-foreground"
            : "border border-border bg-card text-foreground",
      )}
    >
      {state === "published" ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
      ) : state === "unpublished" ? (
        <CloudOff aria-hidden="true" className="size-3" />
      ) : (
        <FilePenLine aria-hidden="true" className="size-3" />
      )}
      {label}
    </span>
  );
}

function AuthoringMaterialsPagination({
  onQueryChange,
  query,
  state,
}: {
  readonly onQueryChange?: (query: AuthoringMaterialsQuery) => void;
  readonly query: AuthoringMaterialsQuery;
  readonly state: Extract<AuthoringMaterialsState, { readonly kind: "ready" }>;
}) {
  if (state.totalPages <= 1) return null;
  return (
    <nav
      aria-label="Страницы материалов"
      className="flex items-center justify-between gap-3 py-6"
    >
      {state.page > 1 ? (
        onQueryChange === undefined ? (
          <Button asChild variant="outline">
            <Link href={authoringMaterialsHref(query, state.page - 1)}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              Назад
            </Link>
          </Button>
        ) : (
          <Button
            onClick={() => {
              onQueryChange({ ...query, page: state.page - 1 });
            }}
            type="button"
            variant="outline"
          >
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Назад
          </Button>
        )
      ) : (
        <span />
      )}
      <span className="font-mono text-xs text-muted-foreground">
        Страница {state.page} из {state.totalPages}
      </span>
      {state.page < state.totalPages ? (
        onQueryChange === undefined ? (
          <Button asChild variant="outline">
            <Link href={authoringMaterialsHref(query, state.page + 1)}>
              Далее
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        ) : (
          <Button
            onClick={() => {
              onQueryChange({ ...query, page: state.page + 1 });
            }}
            type="button"
            variant="outline"
          >
            Далее
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        )
      ) : (
        <span />
      )}
    </nav>
  );
}

function AuthoringMaterialsStateView({
  onRetry,
  query,
  state,
}: {
  readonly onRetry?: () => void;
  readonly query: AuthoringMaterialsQuery;
  readonly state: Exclude<AuthoringMaterialsState, { readonly kind: "ready" }>;
}) {
  const currentHref = authoringMaterialsHref(query);
  const view = stateView(state);
  return (
    <>
      <main
        className="grid h-full min-h-svh place-items-center bg-background px-5 py-12 text-foreground md:min-h-0"
        id="authoring-content"
        tabIndex={-1}
      >
        <section
          aria-labelledby="authoring-materials-state-heading"
          className="w-full max-w-xl border-y border-border py-10 text-center"
          role="alert"
        >
          {view.icon}
          <h1
            className="mt-5 text-2xl font-semibold tracking-[-0.025em]"
            id="authoring-materials-state-heading"
          >
            {view.heading}
          </h1>
          <p className="mx-auto mt-3 max-w-[52ch] text-sm leading-6 text-muted-foreground">
            {view.description}
          </p>
          {view.reference === undefined ? null : (
            <p className="mt-3 font-mono text-[0.6875rem] text-muted-foreground">
              Код обращения: {view.reference}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {state.kind === "signed_out" ? (
              <form action="/auth/sign-in" method="post">
                <Button type="submit">Войти</Button>
              </form>
            ) : onRetry === undefined ? (
              <Button asChild>
                <Link href={currentHref}>Повторить</Link>
              </Button>
            ) : (
              <Button onClick={onRetry} type="button">
                Повторить
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/library">База знаний</Link>
            </Button>
          </div>
        </section>
      </main>
    </>
  );
}

function stateView(state: Exclude<AuthoringMaterialsState, { readonly kind: "ready" }>) {
  switch (state.kind) {
    case "signed_out":
      return {
        description: "Войдите под доверенным автором, чтобы увидеть все черновики и опубликованные материалы.",
        heading: "Нужен вход автора",
        icon: <LockKeyhole aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />,
      };
    case "forbidden":
      return {
        description: "Текущая учётная запись не имеет права управлять материалами. Войдите под доверенным автором.",
        heading: "Нет доступа к материалам",
        icon: <ShieldAlert aria-hidden="true" className="mx-auto size-8 text-destructive" />,
      };
    case "unavailable":
      return {
        description: "Хранилище материалов временно недоступно. Список не изменён — повторите чтение.",
        heading: "Список временно недоступен",
        icon: <CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />,
        reference: state.reference,
      };
    case "malformed_response":
      return {
        description: "Сервер вернул неполный ответ. Данные не показаны, чтобы не скрыть реальное состояние материалов.",
        heading: "Не удалось проверить список",
        icon: <ShieldAlert aria-hidden="true" className="mx-auto size-8 text-destructive" />,
        reference: "malformed-response",
      };
    case "unexpected_error":
      return {
        description: "Произошла непредвиденная ошибка чтения. Повторите запрос; материалы не изменялись.",
        heading: "Не удалось открыть материалы",
        icon: <CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />,
        reference: state.reference,
      };
  }
}

export function AuthoringMaterialsLoading() {
  return (
    <>
      <main
        aria-busy="true"
        aria-label="Загрузка списка материалов"
        className="min-h-svh bg-background px-4 py-8 text-foreground md:min-h-0 sm:px-7 lg:px-10"
        id="authoring-content"
        tabIndex={-1}
      >
        <div className="mx-auto w-full max-w-[76rem] animate-pulse motion-reduce:animate-none">
          <div className="h-10 w-52 rounded-lg bg-muted" />
          <div className="mt-4 h-5 max-w-xl rounded bg-muted" />
          <div className="mt-10 h-11 w-full rounded-xl bg-muted" />
          <div className="mt-8 divide-y divide-border border-y border-border">
            {[0, 1, 2].map((item) => (
              <div className="py-6" key={item}>
                <div className="h-5 w-24 rounded bg-muted" />
                <div className="mt-3 h-7 w-2/3 rounded bg-muted" />
                <div className="mt-3 h-4 w-1/2 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}

function withMaterialSearch(
  query: AuthoringMaterialsQuery,
  search: string,
): AuthoringMaterialsQuery {
  return {
    page: 1,
    ...(query.publicationState === undefined
      ? {}
      : { publicationState: query.publicationState }),
    ...(search === "" ? {} : { search }),
  };
}

function withPublicationState(
  query: AuthoringMaterialsQuery,
  state: string,
): AuthoringMaterialsQuery {
  return {
    page: 1,
    ...(state === "draft" || state === "published" || state === "unpublished"
      ? { publicationState: state }
      : {}),
    ...(query.search === undefined ? {} : { search: query.search }),
  };
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function formatMaterialCount(count: number): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  const noun =
    remainder100 >= 11 && remainder100 <= 14
      ? "материалов"
      : remainder10 === 1
        ? "материал"
        : remainder10 >= 2 && remainder10 <= 4
          ? "материала"
          : "материалов";
  return `${String(count)} ${noun}`;
}

function localizedTaxonomyValue(value: string | null): string {
  if (value === null) return "не выбран";
  return materialTaxonomyLabel(value);
}
