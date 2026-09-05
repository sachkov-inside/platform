import { ArrowLeft, ArrowUpRight, LockKeyhole, SearchX, ShieldAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type { MaterialReaderMetadata } from "@/_pages/material-reader/model/material-reader-view";
import type { SeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import { ContentCoverImage, materialTaxonomyLabel } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import {
  libraryMaterialReaderReturnTarget,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { ReaderBackAction, SeriesReaderNavigation } from "./material-reader-view";

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

export function MaterialReaderNotFound({
  returnTarget = libraryMaterialReaderReturnTarget,
}: {
  readonly returnTarget?: MaterialReaderReturnTarget;
}) {
  return (
    <ReaderStatus
      action={
        <Button asChild size="lg">
          <Link href={returnTarget.href}>
            <ArrowLeft aria-hidden="true" />
            {returnTarget.label}
          </Link>
        </Button>
      }
      icon={<SearchX aria-hidden="true" />}
      message="Проверьте адрес или выберите другой материал в Базе знаний."
      state="not-found"
      title="Материал не найден"
    />
  );
}

export function MaterialReaderAccess({
  cta,
  material,
  returnTarget = libraryMaterialReaderReturnTarget,
  seriesContext = null,
}: {
  readonly cta: {
    readonly label: "Получить доступ";
    readonly url: string;
  };
  readonly material: MaterialReaderMetadata;
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly seriesContext?: SeriesReaderContext | null;
}) {
  return (
    <div
      className="max-w-[60rem]"
      data-material-reader-state="access-required"
    >
      <ReaderBackAction target={returnTarget} />
      <div className="mx-auto mt-7 max-w-[60rem] md:mt-10">
        <ContentCoverImage
          alt=""
          className="aspect-video min-h-0 w-full rounded-[1.5rem] md:rounded-[2rem]"
          cover={material.cover}
          fallbackKind="material"
          fallbackSeed={material.slug}
          sizes="(min-width: 1024px) 60rem, 100vw"
        />
        <header className="mx-auto mt-8 max-w-[43rem] md:mt-12">
          <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.14em] text-action">
            <span>{materialTaxonomyLabel(material.format.name)}</span>
            <span aria-hidden="true">·</span>
            <Link
              className="no-underline hover:text-foreground focus-visible:outline-ring"
              href={`/topics/${material.topic.slug}`}
              prefetch={false}
            >
              {material.topic.name}
            </Link>
          </div>
          <h1 className="mt-3 max-w-[22ch] text-balance text-[2.3rem] font-semibold leading-[1.02] tracking-[-0.055em] md:text-[3.75rem]">
            {material.title}
          </h1>
          <p className="mt-5 max-w-[65ch] text-pretty text-lg leading-8 text-muted-foreground">
            {material.summary}
          </p>
        </header>
      </div>
      <section
        className="relative mx-auto mt-10 max-w-[43rem] overflow-hidden rounded-[2rem] border border-black/6 bg-muted p-6 md:mt-12 md:p-9"
        aria-labelledby="access-heading"
      >
        <div aria-hidden="true" className="select-none space-y-5 blur-[7px] opacity-45">
          <div className="h-7 w-2/3 rounded-full bg-placeholder-strong" />
          <div className="space-y-3">
            <div className="h-4 rounded-full bg-placeholder" />
            <div className="h-4 w-11/12 rounded-full bg-placeholder" />
            <div className="h-4 w-4/5 rounded-full bg-placeholder" />
          </div>
          <div className="h-36 rounded-[1.5rem] bg-white" />
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-white/20 via-white/70 to-white/95 px-6 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-white text-accent shadow-lg">
            <LockKeyhole aria-hidden="true" className="size-5" />
          </span>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.04em]" id="access-heading">
            Продолжение для участников
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Откройте полный материал и весь маршрут по теме.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild className="h-11 rounded-xl bg-accent px-4 text-white hover:bg-accent-hover" size="lg">
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
        </div>
      </section>
      <SeriesReaderNavigation context={seriesContext} />
    </div>
  );
}

export function MaterialReaderUnavailable({
  retryHref,
  returnTarget = libraryMaterialReaderReturnTarget,
}: {
  readonly retryHref: Route;
  readonly returnTarget?: MaterialReaderReturnTarget;
}) {
  return (
    <ReaderStatus
      action={
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={retryHref}>Повторить</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={returnTarget.href}>{returnTarget.label}</Link>
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

export function MaterialReaderUnexpectedError({
  onRetry,
  returnTarget = libraryMaterialReaderReturnTarget,
}: {
  readonly onRetry: () => void;
  readonly returnTarget?: MaterialReaderReturnTarget;
}) {
  return (
    <ReaderStatus
      action={
        <div className="flex flex-wrap gap-3">
          <Button onClick={onRetry} size="lg">Повторить</Button>
          <Button asChild size="lg" variant="outline">
            <Link href={returnTarget.href}>{returnTarget.label}</Link>
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
