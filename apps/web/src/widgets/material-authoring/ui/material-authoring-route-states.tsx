import { ArrowLeft, CloudOff, LogIn, ShieldAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";
import { authoringMaterialsRootHref } from "@/shared/routing/authoring";


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
      heading={preview ? "Нет доступа к предпросмотру" : "Нет доступа к редактору"}
      icon={<ShieldAlert aria-hidden="true" className="mx-auto size-8 text-destructive" />}
    />
  );
}

export function MaterialAuthoringPreviewUnauthorizedState({
  returnHref = authoringMaterialsRootHref,
}: {
  readonly returnHref?: Route;
} = {}) {
  return (
    <MaterialAuthoringUnauthorizedState
      action={<MaterialAuthoringSignInActions returnHref={returnHref} />}
      context="preview"
    />
  );
}

export function MaterialAuthoringSignInActions({
  onBack,
  returnHref = authoringMaterialsRootHref,
}: {
  readonly onBack?: () => void;
  readonly returnHref?: string;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <form action="/auth/sign-in" method="post">
        <input name="returnTo" type="hidden" value={returnHref} />
        <Button type="submit">
          <LogIn aria-hidden="true" data-icon="inline-start" />
          Войти
        </Button>
      </form>
      {onBack === undefined ? (
        <Button asChild variant="outline">
          <Link href={{ pathname: returnHref }}>
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
  editorHref = "/authoring/materials/new",
  reference,
  returnHref = authoringMaterialsRootHref,
  retryHref,
}: {
  readonly editorHref?: Route;
  readonly reference: string;
  readonly returnHref?: Route;
  readonly retryHref: Route;
}) {
  return (
    <MaterialAuthoringStateScreen
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href={retryHref}>Повторить</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={editorHref}>Вернуться в редактор</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={returnHref}>Вернуться к материалам</Link>
          </Button>
        </div>
      }
      description="Черновик не изменён. Повторите чтение сохранённого материала."
      detail={`Код обращения: ${reference}`}
      heading="Не удалось открыть предпросмотр"
      icon={<CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />}
    />
  );
}

export function MaterialAuthoringUnexpectedEditorState({
  reference,
  retryHref = "/authoring/materials/new",
  returnHref = authoringMaterialsRootHref,
}: {
  readonly reference: string;
  readonly retryHref?: Route;
  readonly returnHref?: Route;
}) {
  return (
    <MaterialAuthoringStateScreen
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href={retryHref}>Повторить</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={returnHref}>Вернуться к материалам</Link>
          </Button>
        </div>
      }
      description="Не удалось подтвердить сессию автора. Черновик ещё не создан, данные не изменены."
      detail={`Код обращения: ${reference}`}
      heading="Не удалось открыть редактор"
      icon={<CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />}
    />
  );
}

export function MaterialAuthoringNotFoundState({
  returnHref = authoringMaterialsRootHref,
}: {
  readonly returnHref?: Route;
} = {}) {
  return (
    <MaterialAuthoringStateScreen
      action={
        <Button asChild variant="outline">
          <Link href={returnHref}>Вернуться к материалам</Link>
        </Button>
      }
      description="Материал с таким идентификатором не найден. Локальные изменения не отправлялись."
      heading="Материал не найден"
      icon={<CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />}
    />
  );
}

export function MaterialAuthoringPreviewNotFoundState({
  editorHref = "/authoring/materials/new",
  returnHref = authoringMaterialsRootHref,
}: {
  readonly editorHref?: Route;
  readonly returnHref?: Route;
} = {}) {
  return (
    <MaterialAuthoringStateScreen
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link href={editorHref}>Вернуться в редактор</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={returnHref}>Вернуться к материалам</Link>
          </Button>
        </div>
      }
      description="Сохранённый черновик с таким идентификатором не найден. Повтор чтения не изменит результат."
      heading="Предпросмотр не найден"
      icon={<CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />}
    />
  );
}

function MaterialAuthoringStateScreen({
  action,
  description,
  detail,
  heading,
  icon,
}: {
  readonly action: ReactNode;
  readonly description: string;
  readonly detail?: string;
  readonly heading: string;
  readonly icon: ReactNode;
}) {
  return (
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
  );
}
