"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { guideModeLabels, useGuideMode, type GuideMode } from "@/shared/guide-mode";

export interface MaterialModeBranch {
  readonly content: ReactNode;
  readonly mode: GuideMode;
}

/**
 * Шаг, написанный для обоих режимов прохождения. Читатель видит свой вариант; второй он может
 * раскрыть на месте, и это ничего не меняет в сохранённом режиме. Шаг, написанный для одного
 * режима, в чужом режиме не показывается совсем: он не про этого читателя.
 */
export function MaterialModeVariant({
  branches,
}: {
  readonly branches: readonly MaterialModeBranch[];
}) {
  const { mode } = useGuideMode();
  const [opened, setOpened] = useState(false);
  const panelId = useId();
  const active = branches.find((branch) => branch.mode === mode);
  const other = branches.find((branch) => branch.mode !== mode);

  if (active === undefined) {
    return null;
  }

  return (
    <div className="mt-8" data-material-block="variant" data-variant-mode={mode}>
      {/* Тот же служебный заголовок, каким в маршруте подписана глава: это подпись, не врезка. */}
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">
        {guideModeLabels[active.mode]}
      </p>
      <div className="mt-2" data-variant-branch={active.mode}>
        {active.content}
      </div>
      {other === undefined ? null : (
        <>
          <button
            aria-controls={panelId}
            aria-expanded={opened}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-action hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => {
              setOpened(!opened);
            }}
            type="button"
          >
            <ChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform motion-reduce:transition-none ${opened ? "rotate-180" : ""}`}
            />
            {opened
              ? `Скрыть вариант «${guideModeLabels[other.mode]}»`
              : `Показать вариант «${guideModeLabels[other.mode]}»`}
          </button>
          <div
            className="mt-2 border-l-2 border-border pl-4"
            data-variant-branch={other.mode}
            hidden={!opened}
            id={panelId}
          >
            {other.content}
          </div>
        </>
      )}
    </div>
  );
}
