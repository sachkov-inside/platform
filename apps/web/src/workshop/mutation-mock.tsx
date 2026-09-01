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
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = handler;
    return () => {
      window.fetch = originalFetch;
    };
  }, [handler]);

  return children;
}
