"use client";

import { useCallback, useRef, useState } from "react";

export type CopyTextState = "copied" | "failed" | "idle";

/** How long the copy result stays visible before the control returns to idle. */
const copyFeedbackMs = 2000;

/**
 * Копирует текст в буфер обмена и показывает итог `copyFeedbackMs` миллисекунд.
 * Без Clipboard API или при отказе браузера состояние становится `failed`, и вызывается `onFailure`.
 */
export function useCopyText(text: string, onFailure?: () => void) {
  const [state, setState] = useState<CopyTextState>("idle");
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sequence = useRef(0);
  // Stops the failure callback and reset timer when the copy button disconnects.
  const mounted = useRef(true);

  const copyButtonRef = useCallback((button: HTMLButtonElement | null) => {
    if (button === null) return;
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
      clearTimeout(reset.current);
    };
  }, []);

  const finish = (attempt: number, result: "copied" | "failed") => {
    if (!mounted.current || attempt !== sequence.current) return;
    setState(result);
    if (result === "failed") onFailure?.();
    clearTimeout(reset.current);
    reset.current = setTimeout(() => {
      setState("idle");
    }, copyFeedbackMs);
  };

  const copy = () => {
    const attempt = ++sequence.current;
    clearTimeout(reset.current);
    // A fresh idle state lets a repeated result reach screen readers again.
    setState("idle");
    // The executor calls writeText inside the click and turns a missing Clipboard API into a rejection.
    void new Promise<void>((resolve) => {
      resolve(navigator.clipboard.writeText(text));
    }).then(
      () => {
        finish(attempt, "copied");
      },
      () => {
        finish(attempt, "failed");
      },
    );
  };

  return { copy, copyButtonRef, state };
}
