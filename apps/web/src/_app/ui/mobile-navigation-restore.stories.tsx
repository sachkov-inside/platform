import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, fireEvent, spyOn, waitFor, within } from "storybook/test";
import { ApplicationShell } from "@/widgets/application-shell";
import { committedRoot } from "@/storybook/committed-root";
import { useMobileNavigation } from "./use-mobile-navigation.client";

const meta = { title: "Patterns/Navigation/Remembered Home scroll" };
export default meta;

function Navigation({ pathname, tall }: { pathname: string; tall: boolean }) {
  const { homeHref } = useMobileNavigation(pathname, null, false);
  return (
    <ApplicationShell
      currentPath={pathname}
      navigationItems={[]}
      mobileNavigationItems={[]}
    >
      <a
        href={homeHref}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        Return to Home
      </a>
      <div style={{ height: tall ? "250vh" : "1px" }} />
    </ApplicationShell>
  );
}

export const OrdinaryLinkRestoresOnlyItsDestination = {
  render: () => <div />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = canvasElement.appendChild(document.createElement("div"));
    const root = committedRoot(host);
    const previousTop = window.scrollY;
    const cache = new QueryClient();
    const original = location.href;
    const historyState: unknown = history.state;
    const home = "/?topic=platform";
    function show(url: string, tall: boolean) {
      history.replaceState(historyState, "", url);
      root.show(
        <QueryClientProvider client={cache}>
          <Navigation pathname={location.pathname} tall={tall} />
        </QueryClientProvider>,
      );
    }
    const nextFrame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          resolve();
        }),
      );
    const scheduled = spyOn(window, "setTimeout");
    const cleared = spyOn(window, "clearTimeout");
    try {
      show(home, true);
      const content = canvasElement.querySelector<HTMLElement>(
        "[data-application-content]",
      );
      if (!content) throw new Error("Missing shell content");
      const scroller =
        getComputedStyle(content).overflowY === "auto"
          ? content
          : document.scrollingElement;
      if (!scroller) throw new Error("Missing scroll container");
      scroller.scrollTop = 500;
      scroller.dispatchEvent(new Event("scroll"));
      const link = within(canvasElement).getByRole("link", {
        name: "Return to Home",
      });
      await waitFor(() => expect(link).toHaveAttribute("href", home));
      show("/account", false);
      await expect(scroller.scrollTop).toBe(0);
      await fireEvent.click(link);
      show(home, true);
      await waitFor(() => expect(scroller.scrollTop).toBe(500));

      show("/account", false);
      await fireEvent.click(link);
      scheduled.mockClear();
      // Both commits run in one turn, before the pending restoration can time out.
      show(home, false);
      const deadline = scheduled.mock.calls.findIndex(
        ([, delay]) => delay === 3000,
      );
      const timer = scheduled.mock.results[deadline];
      if (timer?.type !== "return")
        throw new Error("Missing scroll restoration deadline");
      show("/bookmarks", true);
      await expect(cleared).toHaveBeenCalledWith(timer.value);
      await nextFrame();
      await nextFrame();
      await expect(scroller.scrollTop).toBe(0);
    } finally {
      cleared.mockRestore();
      scheduled.mockRestore();
      root.unmount();
      host.remove();
      cache.clear();
      window.scrollTo(0, previousTop);
      history.replaceState(historyState, "", original);
    }
  },
};
