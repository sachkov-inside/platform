import { deliverAnnouncement } from "@/storybook/deliver-announcement";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect } from "storybook/test";
import { factAnnouncement, type FactAnnouncement } from "./fact-announcement";
import { useAnnouncedRefresh } from "./use-announced-refresh.client";

const meta = { title: "Patterns/API/Announced refresh" };
export default meta;
function Query({
  source,
  scope,
}: {
  source: FactAnnouncement | null;
  scope: string;
}) {
  useAnnouncedRefresh(source, [scope]);
  return null;
}
export const QueryLifetime = {
  render: () => <div />,
  play: async () => {
    const root = createRoot(document.createElement("div"));
    const first = new QueryClient();
    const second = new QueryClient();
    const caches = [first, second];
    const a = factAnnouncement("storybook.query-refresh.a");
    const b = factAnnouncement("storybook.query-refresh.b");
    function mount(
      cache: QueryClient,
      source: FactAnnouncement | null,
      scope: string,
    ) {
      flushSync(() => {
        root.render(
          <QueryClientProvider client={cache}>
            <Query source={source} scope={scope} />
          </QueryClientProvider>,
        );
      });
    }
    async function check(
      source: FactAnnouncement,
      target?: QueryClient,
      scope?: string,
    ) {
      for (const cache of caches)
        for (const key of ["x", "y"]) cache.setQueryData([key], 1);
      await deliverAnnouncement(source);
      for (const cache of caches)
        for (const key of ["x", "y"])
          await expect(cache.getQueryState([key])?.isInvalidated).toBe(
            cache === target && key === scope,
          );
    }
    try {
      mount(first, null, "x");
      await check(a);
      mount(first, a, "x");
      await check(a, first, "x");
      mount(first, a, "y");
      await check(a, first, "y");
      mount(second, a, "y");
      await check(a, second, "y");
      mount(second, b, "y");
      await check(a);
      await check(b, second, "y");
      mount(second, null, "y");
      await check(b);
      mount(first, a, "x");
      flushSync(() => {
        root.render(null);
      });
      await check(a);
    } finally {
      root.unmount();
      for (const cache of caches) cache.clear();
    }
  },
};
