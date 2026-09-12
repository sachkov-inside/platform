"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";

type CopyState = "failed" | "idle" | "copied";

const labels: Readonly<Record<CopyState, string>> = {
  copied: "Скопировано",
  failed: "Не удалось",
  idle: "Копировать",
};

/** Готовый промпт: читатель забирает текст целиком одной кнопкой. */
export function MaterialAgentPrompt({
  text,
  title,
}: {
  readonly text: string;
  readonly title?: string | undefined;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      clearTimeout(reset.current);
    },
    [],
  );

  const copy = () => {
    clearTimeout(reset.current);
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setState("copied");
      })
      .catch(() => {
        setState("failed");
      })
      .finally(() => {
        reset.current = setTimeout(() => {
          setState("idle");
        }, 2000);
      });
  };

  return (
    <div
      className="mt-8 overflow-hidden rounded-xl bg-sidebar text-sidebar-foreground"
      data-material-block="agentPrompt"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
        <p className="min-w-0 break-words text-sm font-semibold">
          {title ?? "Промпт"}
        </p>
        <Button
          className="min-h-11 min-w-[10.5rem] rounded-xl bg-sidebar-accent px-4 text-sidebar-accent-foreground hover:bg-sidebar-accent/80"
          onClick={copy}
          type="button"
          variant="secondary"
        >
          {state === "copied" ? (
            <Check aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          <span role="status">{labels[state]}</span>
        </Button>
      </div>
      <pre
        className="overflow-x-auto px-5 pb-5 font-mono text-[0.8125rem] leading-6 [scrollbar-color:var(--sidebar-border)_var(--sidebar)] sm:px-6"
        tabIndex={0}
      >
        <code>{text}</code>
      </pre>
    </div>
  );
}
