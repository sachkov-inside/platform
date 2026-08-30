"use client";

import { CloudOff } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { MaterialAuthoringShell } from "@/features/material-authoring";
import { Button } from "@/shared/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <MaterialAuthoringShell current="create">
      <main
        className="grid h-full min-h-svh place-items-center bg-background px-5 py-12 text-foreground md:min-h-0"
        id="authoring-content"
        tabIndex={-1}
      >
        <section
          aria-labelledby="material-authoring-error-heading"
          className="w-full max-w-xl border-y border-border py-10 text-center"
          role="alert"
        >
          <CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />
          <h1
            className="mt-5 text-2xl font-semibold tracking-[-0.025em]"
            id="material-authoring-error-heading"
          >
            Редактор остановлен
          </h1>
          <p className="mx-auto mt-3 max-w-[52ch] text-sm leading-6 text-muted-foreground">
            Произошла непредвиденная ошибка. Повторите действие или вернитесь к материалам.
          </p>
          <p className="mt-3 font-mono text-[0.6875rem] text-muted-foreground">
            Код обращения: {error.digest ?? "authoring-boundary"}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={reset} type="button">Повторить</Button>
            <Button asChild variant="outline">
              <Link href="/library">Вернуться к материалам</Link>
            </Button>
          </div>
        </section>
      </main>
    </MaterialAuthoringShell>
  );
}
