"use client";

import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import { cn } from "@/shared/lib/utils";
import {
  guideModeLabels,
  guideModes,
  rememberGuestGuideMode,
  useGuideMode,
} from "@/shared/guide-mode";

import { saveReaderGuideMode } from "../api/guide-mode.browser";

/**
 * Выбор режима прохождения. Он стоит в шапке каждого урока руководства, у которого есть шаги для
 * обоих режимов. Содержание меняется сразу, а запоминание идёт следом: у вошедшего — за аккаунтом,
 * у гостя — в этом браузере.
 */
export function GuideModeSwitch({ signedIn }: { readonly signedIn: boolean }) {
  const { mode, select } = useGuideMode();
  const [failed, setFailed] = useState(false);
  const labelId = useId();
  const save = useMutation({
    mutationFn: saveReaderGuideMode,
    onSuccess: (result) => {
      setFailed(result.kind !== "saved");
    },
    onError: () => {
      setFailed(true);
    },
  });

  return (
    <div className="mt-4" data-guide-mode-switch>
      {/* Подпись обязательна из-за соседства: без неё переключатель, стоящий под списком «Чему
          научишься», читается как продолжение этого списка, а это другой смысл. Видимая подпись
          она же и доступное имя группы — одно название, а не два. */}
      <p className="text-sm font-medium text-muted-foreground" id={labelId}>
        Способ прохождения
      </p>
      <div
        aria-labelledby={labelId}
        className="mt-2 inline-flex max-w-full flex-wrap items-center gap-1 rounded-3xl bg-muted p-1"
        role="group"
      >
        {guideModes.map((option) => (
          <button
            aria-pressed={option === mode}
            className={cn(
              "min-h-11 max-w-full whitespace-normal rounded-3xl px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              option === mode
                ? "bg-background text-foreground shadow-card"
                : "text-muted-foreground hover:text-foreground",
            )}
            key={option}
            onClick={() => {
              if (option === mode) return;
              setFailed(false);
              select(option);
              if (signedIn) save.mutate(option);
              else rememberGuestGuideMode(option);
            }}
            type="button"
          >
            {guideModeLabels[option]}
          </button>
        ))}
      </div>
      {failed ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          Режим показан, но запомнить его не удалось. Попробуйте переключить ещё раз.
        </p>
      ) : null}
    </div>
  );
}
