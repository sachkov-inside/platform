"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/shared/ui/button";
import { guideModeLabels, useGuideMode } from "@/shared/guide-mode";

const HINT_STORAGE_KEY = "inside.guide-mode-hint.v1";

function subscribeSeen(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
  };
}

function readSeen(): boolean {
  try {
    return localStorage.getItem(HINT_STORAGE_KEY) === "seen";
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(HINT_STORAGE_KEY, "seen");
  } catch {
    // Недоступное хранилище означает, что подсказка появится ещё раз, а не что урок сломался.
  }
}

/**
 * Подсказка о двух режимах у первого вариантного шага. Показывается один раз на браузер: она
 * объясняет устройство руководства, и повторять это на каждом уроке незачем.
 *
 * Ответ сервера одинаков для всех, а «видел ли читатель подсказку» знает только его браузер,
 * поэтому на сервере она считается уже показанной и появляется после гидратации.
 */
export function GuideModeHint() {
  const { mode } = useGuideMode();
  const [dismissed, setDismissed] = useState(false);
  const seen = useSyncExternalStore(
    subscribeSeen,
    readSeen,
    useCallback(() => true, []),
  );

  // Подсказка засчитывается показанной сразу, а не по кнопке: иначе читатель, который просто
  // пролистал её, встречал бы её снова на каждом уроке руководства.
  useEffect(() => {
    if (!seen) remember();
  }, [seen]);

  if (seen || dismissed) return null;

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
          remember();
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
