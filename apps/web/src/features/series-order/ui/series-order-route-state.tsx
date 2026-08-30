import { ArrowLeft, CloudOff } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { MaterialAuthoringShell, authoringMaterialsRootHref } from "@/features/material-authoring";
import { Button } from "@/shared/ui/button";

type RouteState =
  | { readonly kind: "empty" }
  | { readonly kind: "not_found" }
  | { readonly kind: "error"; readonly reference: string };

export function SeriesOrderRouteState({
  retryHref = "/authoring/playlists",
  state,
}: {
  readonly retryHref?: Route;
  readonly state: RouteState;
}) {
  const content = routeStateContent(state);
  return (
    <MaterialAuthoringShell current="playlists">
      <main
        className="grid h-full min-h-svh place-items-center bg-background p-6 text-center md:min-h-0"
        id="authoring-content"
      >
        <div className="max-w-md">
          <CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />
          <h1 className="mt-5 text-2xl font-semibold">{content.title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{content.text}</p>
          {state.kind === "error" ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              Код обращения: {state.reference}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {state.kind === "empty" ? null : (
              <Button asChild>
                <Link href={retryHref}>
                  {state.kind === "not_found" ? "Выбрать другой плейлист" : "Повторить"}
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={authoringMaterialsRootHref}>
                <ArrowLeft aria-hidden="true" data-icon="inline-start" />
                К материалам
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </MaterialAuthoringShell>
  );
}

function routeStateContent(state: RouteState): { readonly text: string; readonly title: string } {
  if (state.kind === "empty") {
    return {
      text: "Добавьте плейлист в справочные данные, чтобы управлять порядком материалов.",
      title: "Плейлистов пока нет",
    };
  }
  if (state.kind === "not_found") {
    return {
      text: "Возможно, плейлист был удалён. Выберите другой плейлист и продолжите работу.",
      title: "Плейлист не найден",
    };
  }
  return {
    text: "Данные не изменены. Повторите попытку после восстановления соединения.",
    title: "Не удалось открыть плейлист",
  };
}
