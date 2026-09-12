"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import {
  guideModeLabels,
  guideModes,
  useGuideMode,
  GUEST_GUIDE_MODE_COOKIE,
  GUEST_GUIDE_MODE_COOKIE_MAX_AGE,
  type GuideMode,
} from "@/shared/guide-mode";

import { saveReaderGuideMode } from "../api/guide-mode.browser";

function rememberGuestGuideMode(mode: GuideMode): void {
  try {
    document.cookie = `${GUEST_GUIDE_MODE_COOKIE}=${mode}; path=/; max-age=${String(GUEST_GUIDE_MODE_COOKIE_MAX_AGE)}; samesite=lax`;
  } catch {
    // Запрет на запись cookie меняет только память между входами, а не текущий урок.
  }
}

/**
 * Выбор режима прохождения. Он стоит в шапке каждого урока руководства, у которого есть шаги для
 * обоих режимов. Содержание меняется сразу, а запоминание идёт следом: у вошедшего — за аккаунтом,
 * у гостя — в этом браузере.
 */
export function GuideModeSwitch({ signedIn }: { readonly signedIn: boolean }) {
  const { mode, select } = useGuideMode();
  const [failed, setFailed] = useState(false);
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
      <div
        aria-label="Режим прохождения руководства"
        className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-3xl bg-muted p-1"
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
