"use client";

import { useEffect, useRef, useState } from "react";

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
  // Stops the failure callback and the reset timer once the control has unmounted.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(reset.current);
    };
  }, []);

  const finish = (result: "copied" | "failed") => {
    if (!mounted.current) return;
    setState(result);
    if (result === "failed") onFailure?.();
    clearTimeout(reset.current);
    reset.current = setTimeout(() => {
      setState("idle");
    }, copyFeedbackMs);
  };

  const copy = () => {
    clearTimeout(reset.current);
    // A fresh idle state lets a repeated result reach screen readers again.
    setState("idle");
    // The executor calls writeText inside the click and turns a missing Clipboard API into a rejection.
    void new Promise<void>((resolve) => {
      resolve(navigator.clipboard.writeText(text));
    }).then(
      () => {
        finish("copied");
      },
      () => {
        finish("failed");
      },
    );
  };

  return { copy, state };
}
