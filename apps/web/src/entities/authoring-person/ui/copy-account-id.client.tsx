"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { shortAccountId } from "../model/person-identity";

/**
 * ID аккаунта мелко, с копированием полного значения. Копирование подтверждается текстом рядом,
 * который читает и экранный диктор; ширина строки при этом не меняется.
 */
export function CopyAccountId({ accountId }: { readonly accountId: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <span className="font-mono tabular-nums" title={accountId}>
        ID {shortAccountId(accountId)}
      </span>
      <button
        type="button"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        aria-label={`Скопировать ID ${accountId}`}
        onClick={(event) => {
          event.stopPropagation();
          void navigator.clipboard.writeText(accountId).then(
            () => {
              setCopied("copied");
            },
            () => {
              setCopied("failed");
            },
          );
        }}
      >
        {copied === "copied" ? (
          <Check aria-hidden="true" className="size-3.5" />
        ) : (
          <Copy aria-hidden="true" className="size-3.5" />
        )}
      </button>
      <span role="status" className="min-w-0">
        {copied === "copied"
          ? "Скопировано"
          : copied === "failed"
            ? "Не удалось скопировать"
            : ""}
      </span>
    </span>
  );
}
