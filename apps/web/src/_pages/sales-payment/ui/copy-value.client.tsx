"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * Номер, который владелец передаёт в банк или поддержку: виден целиком и копируется одной кнопкой.
 * Итог копирования озвучивается вежливо и виден рядом с кнопкой.
 */
export function CopyValue({
  value,
  label,
}: {
  readonly value: string;
  /** Что копируем, для имени кнопки: «номер заказа». */
  readonly label: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0">
      <span className="min-w-0 font-mono text-[13px] tabular-nums [overflow-wrap:anywhere]">
        {value}
      </span>
      <button
        aria-label={`Скопировать ${label}`}
        className="inline-grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => {
              setState("copied");
            },
            () => {
              setState("failed");
            },
          );
        }}
        title={`Скопировать ${label}`}
        type="button"
      >
        {state === "copied" ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </button>
      <span aria-live="polite" className="text-xs text-muted-foreground">
        {state === "copied"
          ? "Скопировано"
          : state === "failed"
            ? "Не скопировалось, выделите номер вручную"
            : ""}
      </span>
    </span>
  );
}
