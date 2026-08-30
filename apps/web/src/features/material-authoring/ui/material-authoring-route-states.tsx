import { ArrowLeft, CloudOff, LogIn, ShieldAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";

import { MaterialAuthoringShell } from "./material-authoring-shell";

const authoringMaterialsHref = ("/authoring" + "/materials") as Route;

export function MaterialAuthoringUnauthorizedState({
  action,
  context,
}: {
  readonly action: ReactNode;
  readonly context: "editor" | "preview";
}) {
  const preview = context === "preview";
  return (
    <MaterialAuthoringStateScreen
      action={action}
      description={
        preview
          ? "Текущая сессия не подтверждает право просматривать черновик. Войдите под доверенным автором или вернитесь к материалам."
          : "Текущая сессия не подтверждает право изменять материалы. Войдите под доверенным автором или вернитесь к материалам."
      }
      heading={preview ? "Нет доступа к Preview" : "Нет доступа к редактору"}
      icon={<ShieldAlert aria-hidden="true" className="mx-auto size-8 text-destructive" />}
      shellCurrent={preview ? "preview" : "create"}
    />
  );
}

export function MaterialAuthoringPreviewUnauthorizedState() {
  return (
    <MaterialAuthoringUnauthorizedState
      action={<MaterialAuthoringSignInActions />}
      context="preview"
    />
  );
}

export function MaterialAuthoringSignInActions({
  onBack,
}: {
  readonly onBack?: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <form action="/auth/sign-in" method="post">
        <Button type="submit">
          <LogIn aria-hidden="true" data-icon="inline-start" />
          Войти
        </Button>
      </form>
      {onBack === undefined ? (
        <Button asChild variant="outline">
          <Link href={authoringMaterialsHref}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Вернуться к материалам
          </Link>
        </Button>
      ) : (
        <Button onClick={onBack} type="button" variant="outline">
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          Вернуться к материалам
        </Button>
      )}
    </div>
  );
}

export function MaterialAuthoringUnexpectedPreviewState({
  reference,
  retryHref,
}: {
  readonly reference: string;
  readonly retryHref: string;
}) {
  return (
    <MaterialAuthoringStateScreen
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href={{ pathname: retryHref }}>Повторить</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/authoring/materials/new">Вернуться в редактор</Link>
          </Button>
        </div>
      }
      description="Черновик не изменён. Повторите чтение сохранённой версии."
      detail={`Код обращения: ${reference}`}
      heading="Не удалось открыть Preview"
      icon={<CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />}
      shellCurrent="preview"
    />
  );
}

export function MaterialAuthoringUnexpectedEditorState({
  reference,
  retryHref = "/authoring/materials/new",
}: {
  readonly reference: string;
  readonly retryHref?: string;
}) {
  return (
    <MaterialAuthoringStateScreen
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href={{ pathname: retryHref }}>Повторить</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={authoringMaterialsHref}>Вернуться к материалам</Link>
          </Button>
        </div>
      }
      description="Не удалось подтвердить сессию автора. Черновик ещё не создан, данные не изменены."
      detail={`Код обращения: ${reference}`}
      heading="Не удалось открыть редактор"
      icon={<CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />}
      shellCurrent="create"
    />
  );
}

export function MaterialAuthoringNotFoundState() {
  return (
    <MaterialAuthoringStateScreen
      action={
        <Button asChild variant="outline">
          <Link href={authoringMaterialsHref}>Вернуться к материалам</Link>
        </Button>
      }
      description="Material с таким идентификатором не найден. Локальные изменения не отправлялись."
      heading="Material не найден"
      icon={<CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />}
      shellCurrent="create"
    />
  );
}

export function MaterialAuthoringPreviewNotFoundState() {
  return (
    <MaterialAuthoringStateScreen
      action={
        <Button asChild variant="outline">
          <Link href="/authoring/materials/new">Вернуться в редактор</Link>
        </Button>
      }
      description="Сохранённый черновик с таким идентификатором не найден. Повтор чтения не изменит результат."
      heading="Preview не найден"
      icon={<CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />}
      shellCurrent="preview"
    />
  );
}

function MaterialAuthoringStateScreen({
  action,
  description,
  detail,
  heading,
  icon,
  shellCurrent,
}: {
  readonly action: ReactNode;
  readonly description: string;
  readonly detail?: string;
  readonly heading: string;
  readonly icon: ReactNode;
  readonly shellCurrent: "create" | "preview";
}) {
  return (
    <MaterialAuthoringShell current={shellCurrent}>
      <main
        className="grid h-full min-h-svh place-items-center bg-background px-5 py-12 text-foreground md:min-h-0"
        id="authoring-content"
        tabIndex={-1}
      >
        <section
          aria-labelledby="material-authoring-state-heading"
          className="w-full max-w-xl border-y border-border py-10 text-center"
          role="alert"
        >
          {icon}
          <h1
            className="mt-5 text-2xl font-semibold tracking-[-0.025em]"
            id="material-authoring-state-heading"
          >
            {heading}
          </h1>
          <p className="mx-auto mt-3 max-w-[52ch] text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          {detail === undefined ? null : (
            <p className="mt-3 font-mono text-[0.6875rem] text-muted-foreground">{detail}</p>
          )}
          <div className="mt-6">{action}</div>
        </section>
      </main>
    </MaterialAuthoringShell>
  );
}
