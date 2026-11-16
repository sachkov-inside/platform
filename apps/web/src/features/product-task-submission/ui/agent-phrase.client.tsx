"use client";

import { Check, Copy } from "lucide-react";
import {
  type CopyTextState,
  useCopyText,
} from "@/shared/lib/use-copy-text.client";

import { Button } from "@/shared/ui/button";

const labels: Record<CopyTextState, string> = {
  idle: "Скопировать запрос",
  copied: "Скопировано",
  failed: "Не удалось скопировать",
};

/** The phrase for the learner's agent; it wraps instead of scrolling, since it is one sentence. */
export function AgentPhrase({ text }: { readonly text: string }) {
  const { copy, state } = useCopyText(text);
  return (
    <div
      className="grid gap-5 rounded-xl bg-foreground p-6 text-card"
      data-agent-phrase
    >
      <p className="text-pretty font-mono text-[0.8125rem] leading-6 [overflow-wrap:anywhere]">
        {text}
      </p>
      <Button
        aria-label={labels[state]}
        className="min-h-11 w-fit max-w-full whitespace-normal rounded-lg bg-card px-4 text-foreground hover:bg-card/90"
        onClick={copy}
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
