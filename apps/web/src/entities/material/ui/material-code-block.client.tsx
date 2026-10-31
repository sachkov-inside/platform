"use client";

import { Check, Copy } from "lucide-react";
import { useRef } from "react";

import { type CopyTextState, useCopyText } from "./use-copy-text.client";

const buttonLabels: Readonly<Record<CopyTextState, string>> = {
  copied: "Код скопирован",
  failed: "Скопировать код",
  idle: "Скопировать код",
};

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
      <button
        aria-label={buttonLabels[state]}
        className="m-1.5 inline-grid size-11 shrink-0 place-items-center rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        onClick={copy}
        title={buttonLabels[state]}
        type="button"
      >
        {state === "copied" ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </button>
      <span className="sr-only" role="status">
        {statusText[state]}
      </span>
    </div>
  );
}
