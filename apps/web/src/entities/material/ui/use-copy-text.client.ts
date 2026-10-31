"use client";

import { useEffect, useRef, useState } from "react";

export type CopyTextState = "copied" | "failed" | "idle";

/**
 * Копирует текст в буфер обмена и через 2 секунды возвращает исходное состояние.
 * `onFailure` помогает читателю скопировать текст вручную.
 */
export function useCopyText(text: string, onFailure?: () => void) {
  const [state, setState] = useState<CopyTextState>("idle");
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
        onFailure?.();
      })
      .finally(() => {
        reset.current = setTimeout(() => {
          setState("idle");
        }, 2000);
      });
  };

  return { copy, state };
}
