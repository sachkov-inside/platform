"use client";

import { Check, Copy } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/shared/ui/button";
import { type CopyTextState, useCopyText } from "./use-copy-text.client";

const statusText: Readonly<Record<CopyTextState, string>> = {
  copied: "Код скопирован",
  failed: "Не удалось скопировать. Код выделен, скопируйте его вручную",
  idle: "",
};

/** Блок кода в материале: читатель забирает весь текст одной кнопкой. */
export function MaterialCodeBlock({ text }: { readonly text: string }) {
  const code = useRef<HTMLElement>(null);
  const { copy, state } = useCopyText(text, () => {
    if (code.current !== null)
      window.getSelection()?.selectAllChildren(code.current);
  });

  return (
    <div
      className="mt-8 flex overflow-hidden rounded-xl bg-sidebar text-sidebar-foreground"
      data-material-block="codeBlock"
    >
      <pre
        className="min-w-0 flex-1 overflow-x-auto py-5 pl-5 pr-2 font-mono text-[0.8125rem] leading-6 [scrollbar-color:var(--sidebar-border)_var(--sidebar)]"
        data-material-code-scroll
        tabIndex={0}
      >
        <code ref={code}>{text}</code>
      </pre>
      <Button
        aria-label="Скопировать код"
        className="m-2 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent"
        onClick={copy}
        size="icon-lg"
        title="Скопировать код"
        type="button"
        variant="ghost"
      >
        {state === "copied" ? (
          <Check aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
      </Button>
      <span className="sr-only" role="status">
        {statusText[state]}
      </span>
    </div>
  );
}
