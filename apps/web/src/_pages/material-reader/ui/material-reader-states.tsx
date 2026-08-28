import { ArrowLeft, ArrowUpRight, LockKeyhole, SearchX, ShieldAlert } from "lucide-react";
import Link from "next/link";

import type { MaterialReaderMetadata } from "@/_pages/material-reader/model/material-reader-view";
import { Button } from "@/shared/ui/button";

export function MaterialReaderLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Материал загружается"
      className="max-w-[48rem] pt-1 sm:pt-3"
      data-material-reader-state="loading"
    >
      <div className="animate-pulse rounded-2xl bg-secondary px-6 py-7 shadow-card motion-reduce:animate-none sm:px-8 sm:py-9">
        <div className="size-12 rounded-xl bg-muted" />
        <div className="mt-6 h-9 w-full max-w-lg rounded-xl bg-muted sm:h-11" />
        <div className="mt-4 h-5 w-full max-w-xl rounded-lg bg-muted/80" />
        <div className="mt-2 h-5 w-4/5 max-w-lg rounded-lg bg-muted/80" />
        <div className="mt-7 flex gap-3">
          <div className="h-11 w-32 rounded-xl bg-muted" />
          <div className="h-11 w-40 rounded-xl bg-muted/80" />
        </div>
      </div>
      <p className="sr-only">Загружаем опубликованный материал</p>
    </div>
  );
}

export function MaterialReaderNotFound() {
  return (
    <ReaderStatus
      action={
        <Button asChild size="lg">
          <Link href="/library">
            <ArrowLeft aria-hidden="true" />
            В Библиотеку
          </Link>
        </Button>
      }
      icon={<SearchX aria-hidden="true" />}
      message="Проверьте адрес или выберите другой материал в Библиотеке."
      state="not-found"
      title="Материал не найден"
    />
  );
}

export function MaterialReaderAccess({
  cta,
  material,
}: {
  readonly cta: {
    readonly label: "Получить доступ";
    readonly url: string;
  };
  readonly material: MaterialReaderMetadata;
}) {
  return (
    <div
      className="max-w-[52rem] pt-1 sm:pt-3"
      data-material-reader-state="access-required"
    >
      <div className="flex min-h-11 items-center">
        <Button asChild size="lg" variant="outline">
          <Link href="/library">
            <ArrowLeft aria-hidden="true" />
            В Библиотеку
          </Link>
        </Button>
      </div>
      <header className="mt-7 max-w-[48rem] sm:mt-8">
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-muted-foreground">
          <span className="rounded-full bg-muted px-3 py-1.5">{material.format.name}</span>
          <span className="rounded-full bg-muted px-3 py-1.5">{material.topic.name}</span>
        </div>
        <h1 className="mt-4 max-w-[22ch] text-balance text-[1.75rem] font-semibold leading-[1.12] tracking-[-0.03em] sm:text-[2.25rem]">
          {material.title}
        </h1>
        <p className="mt-4 max-w-[65ch] text-pretty leading-7 text-muted-foreground">
          {material.summary}
        </p>
      </header>
      <section
        className="relative mt-7 isolate overflow-clip rounded-2xl bg-secondary px-6 py-7 shadow-card sm:px-8 sm:py-8"
        aria-labelledby="access-heading"
      >
        <StatusHalo />
        <span className="relative grid size-12 place-items-center rounded-xl bg-background/80 text-accent [&_svg]:size-6">
          <LockKeyhole aria-hidden="true" />
        </span>
        <h2 className="relative mt-5 text-xl font-semibold tracking-[-0.025em] sm:text-2xl" id="access-heading">
          Материал доступен в Мастерской
        </h2>
        <p className="relative mt-3 max-w-[62ch] text-pretty leading-7 text-muted-foreground">
          Вступите, чтобы открыть этот и другие закрытые материалы.
        </p>
        <div className="relative mt-6 flex flex-wrap gap-3">
          <Button asChild className="h-11 rounded-xl px-4" size="lg">
            <a href={cta.url} rel="noopener noreferrer" target="_blank">
              {cta.label}
              <ArrowUpRight
                aria-hidden="true"
                className="text-sidebar-primary transition-transform duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] group-hover/button:-translate-y-0.5 group-hover/button:translate-x-0.5 motion-reduce:transition-none"
                data-icon="inline-end"
              />
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}

export function MaterialReaderUnavailable({ slug }: { readonly slug: string }) {
  return (
    <ReaderStatus
      action={
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={`/materials/${slug}`}>Повторить</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/library">Открыть Библиотеку</Link>
          </Button>
        </div>
      }
      icon={<ShieldAlert aria-hidden="true" />}
      message="Сервис чтения не отвечает. Попробуйте ещё раз через несколько минут."
      state="unavailable"
      title="Материал временно недоступен"
    />
  );
}

export function MaterialReaderUnexpectedError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <ReaderStatus
      action={
        <div className="flex flex-wrap gap-3">
          <Button onClick={onRetry} size="lg">Повторить</Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/library">Открыть Библиотеку</Link>
          </Button>
        </div>
      }
      icon={<ShieldAlert aria-hidden="true" />}
      message="Не удалось загрузить материал. Попробуйте ещё раз."
      state="unexpected-error"
      title="Материал сейчас недоступен"
    />
  );
}

function ReaderStatus({
  action,
  icon,
  message,
  state,
  title,
}: {
  readonly action: React.ReactNode;
  readonly icon: React.ReactNode;
  readonly message: string;
  readonly state: string;
  readonly title: string;
}) {
  return (
    <section className="max-w-[48rem] pt-1 sm:pt-3" data-material-reader-state={state}>
      <div className="relative isolate overflow-clip rounded-2xl bg-secondary px-6 py-7 shadow-card sm:px-8 sm:py-9">
        <StatusHalo />
        <span className="relative grid size-12 place-items-center rounded-xl bg-background/80 text-accent [&_svg]:size-6">
          {icon}
        </span>
        <h1 className="relative mt-5 max-w-[18ch] text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
          {title}
        </h1>
        <p className="relative mt-4 max-w-[60ch] text-pretty leading-7 text-muted-foreground">{message}</p>
        <div className="relative mt-7">{action}</div>
      </div>
    </section>
  );
}

function StatusHalo() {
  return (
    <span
      aria-hidden="true"
      className="reader-status-halo absolute -right-10 -top-16 size-48 rounded-full bg-accent/15"
    />
  );
}
