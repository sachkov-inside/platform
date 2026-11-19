import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Activity,
  createRef,
  useState,
  useImperativeHandle,
  useLayoutEffect,
  type Ref,
  type Dispatch,
  type ReactElement,
} from "react";
import { flushSync } from "react-dom";
import type { StoryObj } from "@storybook/react-vite";
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

function scrollContainer(host: HTMLElement) {
  const content = host.querySelector<HTMLElement>("[data-application-content]");
  if (!content) throw new Error("Missing shell content");
  const container =
    getComputedStyle(content).overflowY === "auto"
      ? content
      : document.scrollingElement;
  if (!container) throw new Error("Missing scroll container");
  return container;
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
      const scroller = scrollContainer(canvasElement);
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

function AcceptedNavigation({
  pathname,
  tall,
}: {
  pathname: string;
  tall: boolean;
}) {
  const auth = useAuthStatus();
  const known = auth.resolved && auth.state !== "unavailable";
  return (
    <>
      <output aria-label="Accepted account">
        {known ? auth.accountId : "unknown"}
      </output>
      <Navigation
        pathname={pathname}
        tall={tall}
        accountId={auth.accountId}
        known={known}
      />
    </>
  );
}

interface Scene {
  pathname: string;
  tall: boolean;
  hidden: boolean;
}
function IdentityCanvas({
  cache,
  control,
  installHttp,
}: {
  cache: QueryClient;
  control: Ref<Dispatch<Scene>>;
  installHttp: () => () => void;
}) {
  const [scene, setScene] = useState<Scene>({
    pathname: "/",
    tall: true,
    hidden: false,
  });
  useImperativeHandle(control, () => setScene, []);
  useLayoutEffect(installHttp, [installHttp]);
  return (
    <QueryClientProvider client={cache}>
      <Activity mode={scene.hidden ? "hidden" : "visible"}>
        <AcceptedNavigation pathname={scene.pathname} tall={scene.tall} />
      </Activity>
    </QueryClientProvider>
  );
}

async function identityScenario(
  host: HTMLElement,
  mount: (node: ReactElement) => Promise<unknown>,
  run: (flow: {
    cache: QueryClient;
    show: (url: string, tall: boolean, hidden?: boolean) => void;
    changeAccount: (hidden?: boolean) => Promise<void>;
    rememberHome: () => Promise<void>;
    clickHome: () => Promise<void>;
    top: () => number;
  }) => Promise<void>,
) {
  const cache = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  const control = createRef<Dispatch<Scene>>();
  const original = location.href;
  const state: unknown = history.state;
  const previousTop = window.scrollY;
  let account = firstAccount;
  function installHttp() {
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
    return () => {
      request.mockRestore();
      cache.clear();
    };
  }
  function show(url: string, tall: boolean, hidden = false) {
    history.replaceState(state, "", url);
    const update = control.current;
    if (!update) throw new Error("Missing mounted navigation");
    flushSync(() => {
      update({ pathname: location.pathname, tall, hidden });
    });
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
    history.replaceState(state, "", "/");
    await mount(
      <IdentityCanvas
        cache={cache}
        control={control}
        installHttp={installHttp}
      />,
    );
    await accepted(firstAccount);
    await run({
      cache,
      show,
      changeAccount,
      async rememberHome() {
        scrollContainer(host).scrollTop = 500;
        scrollContainer(host).dispatchEvent(new Event("scroll"));
        await expect(scrollContainer(host).scrollTop).toBe(500);
        show("/account", false);
        await expect(scrollContainer(host).scrollTop).toBe(0);
      },
      async clickHome() {
        await fireEvent.click(
          within(host).getByRole("link", { name: "Return to Home" }),
        );
      },
      top: () => scrollContainer(host).scrollTop,
    });
  } finally {
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

export const PreviousPositionAfterIdentityReturn: StoryObj<typeof meta> = {
  play: async ({ canvasElement, mount }) =>
    identityScenario(
      canvasElement,
      mount,
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

export const PendingDestinationBeforeIdentityChange: StoryObj<typeof meta> = {
  play: async ({ canvasElement, mount }) =>
    identityScenario(
      canvasElement,
      mount,
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

function isTimerCallback(
  handler: TimerHandler,
): handler is (...args: unknown[]) => void {
  return typeof handler === "function";
}

export const ReturningContentAfterIdentityChange: StoryObj<typeof meta> = {
  play: async ({ canvasElement, mount }) =>
    identityScenario(
      canvasElement,
      mount,
      async ({ rememberHome, changeAccount, clickHome, show, top }) => {
        await rememberHome();
        await clickHome();
        // The account response and layout may take separate browser turns. Hold callbacks
        // scheduled during this one route commit until the new account sees the tall content.
        const resume = Promise.withResolvers<undefined>();
        const timers: Pick<Window, "setTimeout"> = window;
        const schedule = timers.setTimeout.bind(window);
        const clock = spyOn(timers, "setTimeout").mockImplementation(
          (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
            if (!isTimerCallback(callback))
              return schedule(callback, delay, ...args);
            return schedule(() => {
              void resume.promise.then(() => {
                callback(...args);
              });
            }, delay);
          },
        );
        try {
          try {
            show("/", false);
          } finally {
            clock.mockRestore();
          }
          await changeAccount();
          show("/", true);
          await afterRestorationFrame();
          await expect(top()).toBe(0);
        } finally {
          resume.resolve(undefined);
        }
      },
    ),
};
