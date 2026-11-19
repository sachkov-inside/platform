import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import { committedRoot } from "@/storybook/committed-root";
import { useMobileNavigation } from "./use-mobile-navigation.client";

const meta = { title: "Patterns/Navigation/Remembered Home scroll" };
export default meta;

function Navigation({ pathname, tall }: { pathname: string; tall: boolean }) {
  const { homeHref } = useMobileNavigation(pathname, null, false);
  return (
    <>
      <a href={homeHref} onClick={(event) => event.preventDefault()}>
        Home
      </a>
      <div
        data-application-content
        style={{ overflow: "auto", maxHeight: "40vh" }}
      >
        <div style={{ height: tall ? "250vh" : "1px" }} />
      </div>
    </>
  );
}

export const OrdinaryLinkRestoresOnlyItsDestination = {
  render: () => <div />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const root = committedRoot(
      canvasElement.appendChild(document.createElement("div")),
    );
    const cache = new QueryClient();
    const original = location.href;
    const historyState = history.state;
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
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      show(home, true);
      const scroller = canvasElement.querySelector<HTMLElement>(
        "[data-application-content]",
      );
      if (!scroller) throw new Error("Missing scroll container");
      scroller.scrollTop = 500;
      scroller.dispatchEvent(new Event("scroll"));
      const link = within(canvasElement).getByRole("link", { name: "Home" });
      await waitFor(() => expect(link).toHaveAttribute("href", home));
      show("/account", false);
      await expect(scroller.scrollTop).toBe(0);
      fireEvent.click(link);
      show(home, true);
      await waitFor(() => expect(scroller.scrollTop).toBe(500));

      show("/account", false);
      fireEvent.click(link);
      show(home, false);
      await nextFrame();
      await expect(scroller.scrollTop).toBe(0);
      show("/bookmarks", true);
      await nextFrame();
      await nextFrame();
      await expect(scroller.scrollTop).toBe(0);
    } finally {
      root.unmount();
      cache.clear();
      history.replaceState(historyState, "", original);
    }
  },
};
