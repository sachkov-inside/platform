import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity } from "react";
import { accountPresentationQueryKey } from "@/features/account-access";
import {
  libraryCatalogQueryKey,
  parseLibrarySearchParams,
} from "@/features/library-catalog";
import { useAuthStatus } from "./auth-status-control.client";
import { expect, fireEvent, spyOn, waitFor, within } from "storybook/test";
import { ApplicationShell } from "@/widgets/application-shell";
import { committedRoot } from "@/storybook/committed-root";
import { useMobileNavigation } from "./use-mobile-navigation.client";

const meta = { title: "Patterns/Navigation/Remembered Home scroll" };
export default meta;

function Navigation({
  pathname,
  tall,
  accountId = null,
  known = false,
}: {
  pathname: string;
  tall: boolean;
  accountId?: string | null;
  known?: boolean;
}) {
  const { homeHref } = useMobileNavigation(pathname, accountId, known);
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

const firstAccount = "11111111-1111-4111-8111-111111111111";
const secondAccount = "22222222-2222-4222-8222-222222222222";

function AcceptedNavigation({ tall }: { tall: boolean }) {
  const auth = useAuthStatus();
  const known = auth.resolved && auth.state !== "unavailable";
  return (
    <>
      <output aria-label="Accepted account">
        {known ? auth.accountId : "unknown"}
      </output>
      <Navigation
        pathname={location.pathname}
        tall={tall}
        accountId={auth.accountId}
        known={known}
      />
    </>
  );
}

async function identityScenario(
  canvasElement: HTMLElement,
  run: (flow: {
    cache: QueryClient;
    show: (url: string, tall: boolean, hidden?: boolean) => void;
    changeAccount: (hidden?: boolean) => Promise<void>;
    rememberHome: () => Promise<void>;
    clickHome: () => Promise<void>;
    top: () => number;
  }) => Promise<void>,
) {
  const cache = new QueryClient();
  const host = canvasElement.appendChild(document.createElement("div"));
  const root = committedRoot(host);
  const original = location.href;
  const state: unknown = history.state;
  const previousTop = window.scrollY;
  let account = firstAccount;
  const originalFetch = window.fetch.bind(window);
  const request = spyOn(window, "fetch").mockImplementation((input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      location.href,
    );
    if (url.pathname !== "/auth/status") return originalFetch(input, init);
    return Promise.resolve(
      Response.json({
        state: "authenticated",
        accountId: account,
        canManageMaterials: false,
      }),
    );
  });
  function show(url: string, tall: boolean, hidden = false) {
    history.replaceState(state, "", url);
    root.show(
      <QueryClientProvider client={cache}>
        <Activity mode={hidden ? "hidden" : "visible"}>
          <AcceptedNavigation tall={tall} />
        </Activity>
      </QueryClientProvider>,
    );
  }
  function scroller() {
    const content = host.querySelector<HTMLElement>(
      "[data-application-content]",
    );
    if (!content) throw new Error("Missing shell content");
    const container =
      getComputedStyle(content).overflowY === "auto"
        ? content
        : document.scrollingElement;
    if (!container) throw new Error("Missing scroll container");
    return container;
  }
  async function accepted(id: string) {
    await waitFor(() =>
      expect(within(host).getByLabelText("Accepted account")).toHaveTextContent(
        id,
      ),
    );
  }
  async function changeAccount(hidden = false) {
    const output = within(host).getByLabelText("Accepted account");
    if (hidden) {
      show("/account", false, true);
      await expect(output).not.toBeVisible();
    }
    account = secondAccount;
    if (hidden) show("/account", false);
    else window.dispatchEvent(new Event("focus"));
    await accepted(secondAccount);
    await expect(within(host).getByLabelText("Accepted account")).toBe(output);
    await expect(output).toBeVisible();
  }
  try {
    show("/", true);
    await accepted(firstAccount);
    await run({
      cache,
      show,
      changeAccount,
      async rememberHome() {
        scroller().scrollTop = 500;
        scroller().dispatchEvent(new Event("scroll"));
        await expect(scroller().scrollTop).toBe(500);
        show("/account", false);
        await expect(scroller().scrollTop).toBe(0);
      },
      async clickHome() {
        await fireEvent.click(
          within(host).getByRole("link", { name: "Return to Home" }),
        );
      },
      top: () => scroller().scrollTop,
    });
  } finally {
    root.unmount();
    request.mockRestore();
    cache.clear();
    host.remove();
    history.replaceState(state, "", original);
    window.scrollTo(0, previousTop);
  }
}

async function afterRestorationFrame() {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        resolve();
      }),
    ),
  );
}

export const PreviousPositionAfterIdentityReturn = {
  render: () => <div />,
  play: ({ canvasElement }: { canvasElement: HTMLElement }) =>
    identityScenario(
      canvasElement,
      async ({ rememberHome, changeAccount, clickHome, show, top, cache }) => {
        await rememberHome();
        const query = parseLibrarySearchParams(
          new URLSearchParams("topic=platform"),
        ).query;
        const accountKey = accountPresentationQueryKey();
        const catalog = libraryCatalogQueryKey(query);
        const feed = libraryCatalogQueryKey(query, "feed");
        const unrelated = ["library", "public-reference"] as const;
        for (const key of [accountKey, catalog, feed])
          cache.setQueryData(key, "first account");
        cache.setQueryData(unrelated, "public");
        await changeAccount(true);
        await expect(cache.getQueryData(accountKey)).toBeUndefined();
        await expect(cache.getQueryData(catalog)).toBeUndefined();
        await expect(cache.getQueryData(feed)).toBeUndefined();
        await expect(cache.getQueryData(unrelated)).toBe("public");
        await clickHome();
        show("/", true);
        await afterRestorationFrame();
        await expect(top()).toBe(0);
      },
    ),
};

export const PendingDestinationBeforeIdentityChange = {
  render: () => <div />,
  play: ({ canvasElement }: { canvasElement: HTMLElement }) =>
    identityScenario(
      canvasElement,
      async ({ rememberHome, changeAccount, clickHome, show, top }) => {
        await rememberHome();
        await clickHome();
        await changeAccount();
        show("/", true);
        await afterRestorationFrame();
        await expect(top()).toBe(0);
      },
    ),
};

export const ReturningContentAfterIdentityChange = {
  render: () => <div />,
  play: ({ canvasElement }: { canvasElement: HTMLElement }) =>
    identityScenario(
      canvasElement,
      async ({ rememberHome, changeAccount, clickHome, show, top }) => {
        await rememberHome();
        await clickHome();
        // Hold only the restore deadline while waiting for the real auth reader to accept B.
        // The browser still runs layout, ResizeObserver and animation frames normally.
        const timerWindow: Pick<Window, "setTimeout"> = window;
        const nativeTimeout = timerWindow.setTimeout.bind(window);
        let deadlineArmed = false;
        const clock = spyOn(timerWindow, "setTimeout").mockImplementation(
          (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
            if (delay === 3000) {
              deadlineArmed = true;
              return nativeTimeout(() => undefined, delay);
            }
            return nativeTimeout(handler, delay, ...args);
          },
        );
        try {
          show("/", false);
          await expect(deadlineArmed).toBe(true);
          await changeAccount();
          show("/", true);
          await afterRestorationFrame();
          await expect(top()).toBe(0);
        } finally {
          clock.mockRestore();
        }
      },
    ),
};
