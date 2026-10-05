import type { Decorator } from "@storybook/react-vite";
import { useEffect, type ReactNode } from "react";

export type MutationFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function withMutationFetch(handler: MutationFetch): Decorator {
  return (Story) => (
    <MutationFetchScope handler={handler}>
      <Story />
    </MutationFetchScope>
  );
}

function MutationFetchScope({
  children,
  handler,
}: {
  readonly children: ReactNode;
  readonly handler: MutationFetch;
}) {
  useEffect(() => installFetch(handler), [handler]);

  return children;
}

/** Установка подмены: вызов ставит ответ и возвращает снятие. */
type FetchSetup = () => () => void;

/** Одна установка подмены на оба пути: декоратор и `beforeEach` различает только момент. */
function installFetch(handler: MutationFetch): () => void {
  const originalFetch = window.fetch;
  window.fetch = handler;
  return () => {
    window.fetch = originalFetch;
  };
}

/**
 * Ставит ответ до первого рендера. Декоратор монтируется вместе со сторис, поэтому его эффект
 * гонится с запросом, который страница отправляет на первом же рендере; `beforeEach` сторис
 * выполняется раньше и этой гонки не создаёт.
 */
export function fetchBeforeRender(handler: MutationFetch): FetchSetup {
  return () => installFetch(handler);
}
