"use client";

import { Check, Copy } from "lucide-react";
import { Fragment, useRef } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import type { HighlightedCode } from "../model/code-highlight";
import { type CopyTextState, useCopyText } from "./use-copy-text.client";

const statusText: Readonly<Record<CopyTextState, string>> = {
  copied: "Код скопирован",
  failed: "Не удалось скопировать. Код выделен, скопируйте его вручную",
  idle: "",
};

/**
 * Блок кода в материале: читатель забирает весь текст одной кнопкой. Подсветку считает сервер;
 * строки не переносятся, длинная строка прокручивается внутри блока.
 */
export function MaterialCodeBlock({
  highlighted,
  language,
  text,
}: {
  readonly highlighted?: HighlightedCode | undefined;
  readonly language?: string | undefined;
  readonly text: string;
}) {
  const code = useRef<HTMLElement>(null);
  const { copy, state } = useCopyText(text, () => {
    if (code.current !== null)
      window.getSelection()?.selectAllChildren(code.current);
  });
  const label = highlighted?.label ?? language;

  return (
    <div
      className="mt-8 overflow-hidden rounded-xl bg-sidebar text-(--code-foreground)"
      data-material-block="codeBlock"
    >
      <div className="flex min-h-11 items-center justify-between gap-3 pl-5 pr-1.5 pt-1">
        <span className="font-mono text-xs tracking-wide text-(--code-token-comment)">
          {label}
        </span>
        <Button
          aria-label="Скопировать код"
          className="relative text-sidebar-foreground/70 after:absolute after:-inset-[5px] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent"
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
      </div>
      <div
        className="overflow-x-auto overscroll-x-contain"
        data-code-scroll=""
        // A scrolling region is reachable from the keyboard so its hidden part can be read.
        tabIndex={0}
        role="region"
        aria-label={label === undefined ? "Код" : `Код, ${label}`}
      >
        <pre
          className={cn(
            "px-5 pb-5 font-mono text-sm leading-6 [font-variant-ligatures:none]",
            // Code with a language keeps its lines; text without one is often a prompt and wraps.
            label === undefined
              ? "whitespace-pre-wrap [overflow-wrap:anywhere]"
              : "w-max min-w-full whitespace-pre",
          )}
        >
          <code ref={code}>
            {highlighted === undefined
              ? text
              : highlighted.lines.map((line, index) => (
                  <Fragment key={index}>
                    {index > 0 ? "\n" : null}
                    {line.map((token, position) => (
                      <span
                        key={position}
                        style={
                          token.color === undefined
                            ? undefined
                            : { color: token.color }
                        }
                      >
                        {token.text}
                      </span>
                    ))}
                  </Fragment>
                ))}
          </code>
        </pre>
      </div>
      <span className="sr-only" role="status">
        {statusText[state]}
      </span>
    </div>
  );
}
