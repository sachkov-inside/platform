"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";

type CopyState = "idle" | "copied" | "failed";

const labels: Record<CopyState, string> = {
  idle: "Копировать фразу",
  copied: "Скопировано",
  failed: "Не удалось скопировать",
};

/** The phrase for the learner's agent; it wraps instead of scrolling, since it is one sentence. */
export function AgentPhrase({ text }: { readonly text: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(reset.current);
    },
    [],
  );
  return (
    <div
      className="grid gap-3 rounded-xl bg-sidebar p-4 text-sidebar-foreground sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      data-agent-phrase
    >
      <p className="text-pretty font-mono text-[0.8125rem] leading-6 [overflow-wrap:anywhere]">
        {text}
      </p>
      <Button
        className="min-h-11 rounded-xl bg-sidebar-accent px-4 text-sidebar-accent-foreground hover:bg-sidebar-accent/80"
        onClick={() => {
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
        }}
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
  );
}
