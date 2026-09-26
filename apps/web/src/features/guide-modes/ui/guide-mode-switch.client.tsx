"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

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
  const router = useRouter();
  // Вариант шага выбирает сервер, поэтому страницы, которые браузер помнит в кеше маршрутов,
  // отрисованы в прежнем режиме. Запомненный выбор их отбрасывает (ADR 0027).
  const saveBurst = useRef({ inFlight: 0, saved: false });
  const save = useMutation({
    mutationFn: saveReaderGuideMode,
    onSuccess: (result) => {
      setFailed(result.kind !== "saved");
    },
    onSettled: (result) => {
      const burst = saveBurst.current;
      burst.inFlight -= 1;
      if (result?.kind === "saved") burst.saved = true;
      // При быстром переключении туда и обратно страница перечитывается один раз, после последней
      // записи: ответ на первую принёс бы с сервера режим, который читатель уже сменил.
      if (burst.inFlight > 0 || !burst.saved) return;
      burst.saved = false;
      router.refresh();
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
              if (signedIn) {
                saveBurst.current.inFlight += 1;
                save.mutate(option);
              } else {
                rememberGuestGuideMode(option);
                router.refresh();
              }
            }}
            type="button"
          >
            {guideModeLabels[option]}
          </button>
        ))}
      </div>
      {failed ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          Режим показан, но запомнить его не удалось. Попробуйте переключить ещё
          раз.
        </p>
      ) : null}
    </div>
  );
}
