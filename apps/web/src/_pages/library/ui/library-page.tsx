import { DatabaseZap, RefreshCw } from "lucide-react";
import Link from "next/link";

import type { LibraryCatalogPage } from "@/_pages/library/model/library-view";
import { formatMaterialCount } from "@/_pages/library/model/format-material-count";
import { MaterialCard } from "@/entities/material";
import { Button } from "@/shared/ui/button";

export function LibraryPage({
  catalog,
  onRetry,
  result,
}: {
  readonly catalog?: React.ReactNode;
  readonly onRetry?: () => void;
  readonly result: LibraryCatalogPage;
}) {
  return (
    <div className="@container/library -mx-5 -mb-7 overflow-hidden bg-background sm:-mx-8 sm:-mb-10 md:m-0 md:overflow-visible md:bg-transparent">
      <LibraryHeader />
      <div className="px-5 pb-7 sm:px-8 sm:pb-10 md:px-0 md:pb-0">
        {result.kind === "ready"
          ? catalog ?? <LibraryCatalog items={result.items} />
          : null}
        {result.kind === "empty" ? <LibraryEmpty /> : null}
        {result.kind === "unavailable" ? (
          <LibraryUnavailable
            {...(onRetry === undefined ? {} : { onRetry })}
          />
        ) : null}
      </div>
    </div>
  );
}

export function LibraryLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Библиотека загружается"
      className="@container/library -mx-5 -mb-7 overflow-hidden bg-background sm:-mx-8 sm:-mb-10 md:m-0 md:overflow-visible md:bg-transparent"
      data-library-state="loading"
    >
      <LibraryHeader />
      <div className="px-5 pb-7 sm:px-8 sm:pb-10 md:px-0 md:pb-0">
        <section aria-labelledby="library-loading-heading" className="mt-8 sm:mt-10">
          <h2 className="text-lg font-semibold tracking-[-0.025em]" id="library-loading-heading">
            Материалы
          </h2>
          <ul
            aria-hidden="true"
            className="mt-4 grid grid-cols-1 items-start justify-items-center gap-4 @min-[40rem]/library:grid-cols-2 @min-[68rem]/library:grid-cols-3"
            role="list"
          >
            {[0, 1, 2].map((item) => (
              <li className="w-full max-w-[28rem]" key={item}>
                <div className="h-52 animate-pulse rounded-xl bg-muted shadow-card motion-reduce:animate-none" />
              </li>
            ))}
          </ul>
          <p className="sr-only">Загружаем опубликованные материалы</p>
        </section>
      </div>
    </div>
  );
}

export function LibraryUnexpectedError({
  onRetry,
}: {
  readonly onRetry: () => void;
}) {
  return (
    <div className="@container/library -mx-5 -mb-7 overflow-hidden bg-background sm:-mx-8 sm:-mb-10 md:m-0 md:overflow-visible md:bg-transparent">
      <LibraryHeader />
      <div className="px-5 pb-7 sm:px-8 sm:pb-10 md:px-0 md:pb-0">
        <LibraryStatus
          action={
            <div className="flex flex-wrap gap-3">
              <Button onClick={onRetry} size="lg">
                <RefreshCw aria-hidden="true" />
                Повторить
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/library">Открыть первую страницу</Link>
              </Button>
            </div>
          }
          message="Не удалось загрузить каталог. Попробуйте ещё раз."
          state="unexpected-error"
          title="Библиотека сейчас недоступна"
        />
      </div>
    </div>
  );
}

function LibraryHeader() {
  return (
    <header className="rounded-b-2xl bg-card px-5 pb-5 pt-4 sm:px-8 sm:pb-8 sm:pt-10 md:rounded-none md:bg-transparent md:p-0">
      <h1 className="text-balance text-2xl font-semibold leading-7 tracking-[-0.03em] @min-[30rem]/library:text-3xl @min-[30rem]/library:leading-9 @min-[52rem]/library:text-5xl @min-[52rem]/library:leading-[1.1]">
        Библиотека
      </h1>
    </header>
  );
}

export function LibraryCatalog({
  items,
}: {
  readonly items: Extract<LibraryCatalogPage, { readonly kind: "ready" }>["items"];
}) {
  return (
    <section aria-labelledby="materials-heading" className="mt-8 sm:mt-10" data-library-state="ready">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.025em] @min-[30rem]/library:text-xl" id="materials-heading">
            Материалы
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {formatMaterialCount(items.length)} загружено
          </p>
        </div>
      </div>
      <LibraryMaterialGrid className="mt-4" items={items} />
    </section>
  );
}

export function LibraryMaterialGrid({
  className = "",
  items,
  label,
}: {
  readonly className?: string;
  readonly items: Extract<LibraryCatalogPage, { readonly kind: "ready" }>["items"];
  readonly label?: string;
}) {
  return (
    <ul
      {...(label === undefined ? {} : { "aria-label": label })}
      className={`${className} grid grid-cols-1 items-start justify-items-center gap-4 @min-[40rem]/library:grid-cols-2 @min-[68rem]/library:grid-cols-3`}
      data-material-grid
      role="list"
    >
      {items.map((material) => (
        <li className="w-full max-w-[28rem]" key={material.slug}>
          <MaterialCard headingLevel="h3" material={material} />
        </li>
      ))}
    </ul>
  );
}

function LibraryEmpty() {
  return (
    <LibraryStatus
      action={
        <Button asChild size="lg" variant="outline">
          <Link href="/map">Открыть Карту</Link>
        </Button>
      }
      message="После публикации материалы появятся здесь автоматически."
      state="empty"
      title="Опубликованных материалов пока нет"
    />
  );
}

function LibraryUnavailable({ onRetry }: { readonly onRetry?: () => void }) {
  return (
    <LibraryStatus
      action={
        onRetry === undefined ? (
          <Button asChild size="lg">
            <Link href="/library">
              <RefreshCw aria-hidden="true" />
              Повторить
            </Link>
          </Button>
        ) : (
          <Button onClick={onRetry} size="lg">
            <RefreshCw aria-hidden="true" />
            Повторить
          </Button>
        )
      }
      message="Каталог не отвечает. Попробуйте ещё раз через несколько минут."
      state="unavailable"
      title="Библиотека временно недоступна"
    />
  );
}

function LibraryStatus({
  action,
  message,
  state,
  title,
}: {
  readonly action: React.ReactNode;
  readonly message: string;
  readonly state: string;
  readonly title: string;
}) {
  return (
    <section className="mt-8 max-w-[48rem] sm:mt-10" data-library-state={state}>
      <div className="relative isolate overflow-clip rounded-2xl bg-secondary px-6 py-7 shadow-card sm:px-8 sm:py-9">
        <span
          aria-hidden="true"
          className="reader-status-halo absolute -right-10 -top-16 size-48 rounded-full bg-accent/15"
        />
        <span className="relative grid size-12 place-items-center rounded-xl bg-background/80 text-accent [&_svg]:size-6">
          <DatabaseZap aria-hidden="true" />
        </span>
        <h2 className="relative mt-5 max-w-[20ch] text-balance text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
          {title}
        </h2>
        <p className="relative mt-4 max-w-[60ch] text-pretty leading-7 text-muted-foreground">
          {message}
        </p>
        <div className="relative mt-7">{action}</div>
      </div>
    </section>
  );
}
