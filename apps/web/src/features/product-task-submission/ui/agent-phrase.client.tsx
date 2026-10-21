"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";
import styles from "./task-submission-workspace.module.css";

type CopyState = "idle" | "copied" | "failed";

const labels: Record<CopyState, string> = {
  idle: "Скопировать запрос",
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
    <div className={styles["request"]} data-agent-phrase>
      <p className="text-pretty font-mono text-[0.8125rem] leading-6 [overflow-wrap:anywhere]">
        {text}
      </p>
      <Button
        aria-label={labels[state]}
        variant="outline"
        className="min-h-11 w-fit max-w-full shrink-0 whitespace-normal rounded-lg bg-card px-3 text-foreground hover:bg-muted"
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
