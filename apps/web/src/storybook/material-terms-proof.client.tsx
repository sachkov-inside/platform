"use client";

import { Popover } from "radix-ui";
import { useId, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";

/** Development-only presentation proof for #443; no backend, cache, or production route adapter. */
export type TermCardProofState =
  | {
      readonly kind: "ready";
      readonly title: string;
      readonly definition: string;
      readonly example?: string;
      readonly detail?: { readonly href: string; readonly label: string };
    }
  | { readonly kind: "loading" | "unavailable" | "failure" };

/** One inline phrase, one independently supplied authored definition, and an interactive non-modal card. */
export function MaterialTermProof({
  phrase,
  termId,
  state,
}: {
  readonly phrase: string;
  readonly termId: string;
  readonly state: TermCardProofState;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const suppressedFocus = useRef(false);
  const titleId = useId();
  return (
    <Popover.Root modal={false} onOpenChange={setOpen} open={open}>
      <Popover.Trigger asChild>
        <button
          className="rounded-sm text-inherit underline decoration-accent decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-term-id={termId}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
          onFocus={() => {
            if (suppressedFocus.current) {
              suppressedFocus.current = false;
              return;
            }
            setOpen(true);
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") setOpen(true);
          }}
          ref={trigger}
          type="button"
        >
          {phrase}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-labelledby={titleId}
          className="z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-card"
          collisionPadding={16}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            suppressedFocus.current =
              trigger.current !== null &&
              trigger.current.ownerDocument.activeElement !== trigger.current;
            trigger.current?.focus({ preventScroll: true });
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          side="top"
          sideOffset={8}
        >
          <h2 className="text-base font-semibold" id={titleId}>
            {state.kind === "ready" ? state.title : "Определение термина"}
          </h2>
          {state.kind === "ready" ? (
            <>
              <p className="mt-2 whitespace-pre-line break-words text-sm leading-6">
                {state.definition}
              </p>
              {state.example === undefined ? null : (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {state.example}
                </p>
              )}
              {state.detail === undefined ? null : (
                <a
                  className="mt-3 inline-block text-sm underline underline-offset-4"
                  href={state.detail.href}
                >
                  {state.detail.label}
                </a>
              )}
            </>
          ) : (
            <p aria-live="polite" className="mt-2 text-sm leading-6">
              {state.kind === "loading"
                ? "Загружаем определение…"
                : state.kind === "unavailable"
                  ? "Определение сейчас недоступно."
                  : "Не удалось загрузить определение."}
            </p>
          )}
          <Popover.Close asChild>
            <Button className="mt-3" size="sm" variant="ghost">
              Закрыть
            </Button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Isolated fixture container; production Reader and editor remain separate pending integration. */
export function MaterialTermsProof({
  state,
  phrase = "развёртывание",
  termId = "44300000-0000-4000-8000-000000000001",
  secondMaterial = false,
}: {
  readonly state: TermCardProofState;
  readonly phrase?: string;
  readonly termId?: string;
  readonly secondMaterial?: boolean;
}) {
  return (
    <section className="mx-auto max-w-[72ch] px-5 py-16 text-base leading-7">
      <p className="mb-6 text-sm text-muted-foreground">
        Тестовый пакет #443. Storybook proof; runtime доступ и кеш здесь не
        проверяются.
      </p>
      <article>
        <h1 className="mb-4 text-2xl font-semibold">Материал A</h1>
        <p>
          Пример независимой видимой фразы:{" "}
          <MaterialTermProof phrase={phrase} state={state} termId={termId} />.
        </p>
      </article>
      {secondMaterial ? (
        <article className="mt-10">
          <h2 className="mb-4 text-xl font-semibold">Материал B</h2>
          <p>
            Та же запись определения:{" "}
            <MaterialTermProof phrase="деплой" state={state} termId={termId} />.
          </p>
        </article>
      ) : null}
      <Button className="mt-10" variant="outline">
        Контроль вне карточки
      </Button>
    </section>
  );
}
