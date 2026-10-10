"use client";

import { useRef } from "react";

import { useRenderErrorReport } from "@/features/client-telemetry";

/** Сброс формы внутри границы — не `reset` границы. */
export default function AccountError({
  error,
  retry,
}: {
  readonly error: Error;
  readonly retry: () => void;
}) {
  useRenderErrorReport("public", error);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} onSubmit={retry}>
      <button type="reset" onClick={() => form.current?.reset()}>
        Очистить
      </button>
    </form>
  );
}
