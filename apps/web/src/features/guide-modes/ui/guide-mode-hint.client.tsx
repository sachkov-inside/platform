"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  guideModeLabels,
  rememberGuideModeHintSeen,
  useGuideMode,
} from "@/shared/guide-mode";

/**
 * Подсказка о двух режимах у первого вариантного шага. Показывается один раз на браузер: она
 * объясняет устройство руководства, и повторять это на каждом уроке незачем.
 *
 * Показывать её или нет, решает сервер по cookie, поэтому подсказка приходит вместе со страницей
 * и ничего под собой не сдвигает. Засчитывается она показанной сразу, а не по кнопке: читатель,
 * который её просто пролистал, иначе встречал бы её на каждом уроке.
 */
export function GuideModeHint() {
  const { mode } = useGuideMode();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    rememberGuideModeHintSeen();
  }, []);

  if (dismissed) return null;

  return (
    <aside
      className="mt-8 flex items-start gap-3 rounded-xl border border-border bg-muted/60 px-5 py-4 text-sm leading-6"
      data-guide-mode-hint
    >
      <p className="min-w-0 flex-1">
        Руководство можно проходить двумя способами. Сейчас выбран «{guideModeLabels[mode]}»:
        шаги показаны для него. Переключить способ можно в шапке урока, и выбор сохранится
        до конца руководства.
      </p>
      <Button
        aria-label="Понятно, скрыть подсказку"
        onClick={() => {
          setDismissed(true);
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X aria-hidden="true" />
      </Button>
    </aside>
  );
}
