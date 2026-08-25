import { ArrowLeft, LockKeyhole, SearchX, ShieldAlert } from "lucide-react";

import type { MaterialReaderMetadata } from "@/_pages/material-reader/model/material-reader-view";
import { Button } from "@/shared/ui/button";

export function MaterialReaderLoading() {
  return (
    <div aria-busy="true" aria-label="Материал загружается" data-material-reader-state="loading">
      <div className="h-11 border-b border-border" />
      <div className="mt-10 max-w-[56rem] animate-pulse motion-reduce:animate-none">
        <div className="h-7 w-28 rounded-full bg-muted" />
        <div className="mt-5 h-10 w-full max-w-xl rounded-lg bg-muted sm:h-12" />
        <div className="mt-4 h-6 w-full max-w-2xl rounded-lg bg-muted" />
        <div className="mt-8 h-24 w-full max-w-[70ch] rounded-xl bg-muted/70" />
        <div className="mt-10 grid max-w-[70ch] gap-4">
          <div className="h-7 w-2/3 rounded bg-muted" />
          <div className="h-4 w-full rounded bg-muted/70" />
          <div className="h-4 w-5/6 rounded bg-muted/70" />
          <div className="h-4 w-3/4 rounded bg-muted/70" />
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
          <a href="/library">
            <ArrowLeft aria-hidden="true" />
            В Библиотеку
          </a>
        </Button>
      }
      eyebrow="Material · 404"
      icon={<SearchX aria-hidden="true" />}
      message="Проверьте адрес или вернитесь в Библиотеку: возможно, материал ещё не опубликован."
      state="not-found"
      title="Материал не найден"
    />
  );
}

export function MaterialReaderAccess({
  material,
  reason,
}: {
  readonly material: MaterialReaderMetadata;
  readonly reason: "forbidden" | "membership_required" | "temporarily_unavailable";
}) {
  const unavailable = reason === "temporarily_unavailable";
  return (
    <div data-material-reader-state={unavailable ? "access-unavailable" : "access-required"}>
      <div className="flex min-h-11 items-center border-b border-border pb-3">
        <Button asChild className="bg-background" size="lg" variant="outline">
          <a href="/library">
            <ArrowLeft aria-hidden="true" />
            В Библиотеку
          </a>
        </Button>
      </div>
      <header className="mt-10 max-w-[56rem]">
        <p className="font-mono text-[0.6875rem] text-muted-foreground">
          {material.format.name} · {material.topic.name}
        </p>
        <h1 className="mt-5 max-w-[22ch] text-balance text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[2.25rem]">
          {material.title}
        </h1>
        <p className="mt-4 max-w-[65ch] text-pretty leading-7 text-muted-foreground">
          {material.summary}
        </p>
      </header>
      <section className="mt-10 max-w-[70ch] border-y border-border py-7" aria-labelledby="access-heading">
        <div className="mb-5 h-1 w-16 rounded-full bg-accent" />
        {unavailable ? (
          <ShieldAlert aria-hidden="true" className="size-6 text-accent" />
        ) : (
          <LockKeyhole aria-hidden="true" className="size-6 text-accent" />
        )}
        <h2 className="mt-4 text-xl font-semibold tracking-[-0.025em]" id="access-heading">
          {unavailable ? "Проверка доступа временно недоступна" : "Материал доступен участникам"}
        </h2>
        <p className="mt-3 max-w-[62ch] leading-7 text-muted-foreground">
          {unavailable
            ? "Закрытое содержимое не показано. Обновите страницу позже — доступ не откроется автоматически при сбое проверки."
            : "Закрытое содержимое не передано в браузер. Вход и проверка Membership появятся в отдельном безопасном потоке."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {unavailable ? (
            <Button asChild size="lg">
              <a href={`/materials/${material.slug}`}>Проверить снова</a>
            </Button>
          ) : null}
          <Button asChild size="lg" variant={unavailable ? "outline" : "default"}>
            <a href="/library">Открыть Библиотеку</a>
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
            <a href={`/materials/${slug}`}>Повторить</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="/library">Открыть Библиотеку</a>
          </Button>
        </div>
      }
      eyebrow="Material · сервис недоступен"
      icon={<ShieldAlert aria-hidden="true" />}
      message="Сервис чтения или его хранилище временно не отвечает. Повторите запрос через несколько минут."
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
            <a href="/library">Открыть Библиотеку</a>
          </Button>
        </div>
      }
      eyebrow="Material · ошибка загрузки"
      icon={<ShieldAlert aria-hidden="true" />}
      message="Опубликованное содержимое не загрузилось. Повторите запрос; если ошибка сохранится, вернитесь позже."
      state="unexpected-error"
      title="Материал сейчас недоступен"
    />
  );
}

function ReaderStatus({
  action,
  eyebrow,
  icon,
  message,
  state,
  title,
}: {
  readonly action: React.ReactNode;
  readonly eyebrow: string;
  readonly icon: React.ReactNode;
  readonly message: string;
  readonly state: string;
  readonly title: string;
}) {
  return (
    <section className="max-w-[70ch] pt-8 sm:pt-12" data-material-reader-state={state}>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">
        {eyebrow}
      </p>
      <div className="mt-8 border-y border-border py-8 sm:py-10">
        <div className="mb-5 h-1 w-16 rounded-full bg-accent" />
        <span className="block size-6 text-accent">{icon}</span>
        <h1 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 max-w-[60ch] text-pretty leading-7 text-muted-foreground">{message}</p>
        <div className="mt-7">{action}</div>
      </div>
    </section>
  );
}
