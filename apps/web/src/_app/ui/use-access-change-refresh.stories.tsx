import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  announceEnrollmentChange,
  subscribeEnrollmentChange,
} from "@/entities/subscription";
import { currentBillingChanged } from "@/features/billing-subscription/model/current-billing";
import { type FactAnnouncement } from "@/shared/api/fact-announcement";
import { deliverAnnouncement } from "@/storybook/deliver-announcement";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { z } from "zod";
import {
  ReadingProgressProvider,
  readingProgressChanges,
  SavedReadingAction,
  VisibleMaterialOpen,
} from "@/features/reading-progress";
import { getQueryClient } from "@/shared/api/query-client";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { getStoryRouter } from "../../../.storybook/mocks/next-navigation";
import { useAccessChangeRefresh } from "./use-access-change-refresh.client";

const accountId = "20000000-0000-4000-8000-000000001336";
const materialId = "10000000-0000-4000-8000-000000001336";
const at = "2026-10-10T08:00:00.000Z";
const refreshed = fn();
const environment = publicPageEnvironment("/materials/course-intro", {
  account: "authenticated",
});
let isRead = false;
function ProgressRefreshSurface() {
  const pending = useAccessChangeRefresh(accountId, true);
  return (
    <div data-route-refresh-pending={pending}>
      <ReadingProgressProvider accountId={accountId} resolved>
        <VisibleMaterialOpen materialId={materialId} contentVersion={1}>
          <h1>Урок открыт</h1>
          <SavedReadingAction materialId={materialId} format="guide" />
        </VisibleMaterialOpen>
      </ReadingProgressProvider>
    </div>
  );
}
const meta = {
  ...environment,
  id: "app-personal-navigation-refresh",
  title: "Patterns/Navigation/Personal refresh",
  component: ProgressRefreshSurface,
  beforeEach: () => {
    getQueryClient().clear();
    environment.beforeEach();
    refreshed.mockClear();
    isRead = false;
    const router = getStoryRouter();
    const originalRefresh = router.refresh.bind(router);
    router.refresh = refreshed;
    const cleanup = fetchBeforeRender(async (input, init) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      ).pathname;
      const state = {
        materialId,
        isRead,
        version: isRead ? 1 : 0,
        readAt: isRead ? at : null,
        updatedAt: isRead ? at : null,
      };
      if (path === "/api/reading-progress/states")
        return Response.json({
          kind: "ready",
          states: [{ ...state, updateNote: null, openedParts: null }],
        });
      if (path === "/api/reading-progress/open")
        return Response.json({ kind: "saved", openedAt: at, replayed: false });
      if (path === "/api/reading-progress/state") {
        const body = input instanceof Request ? await input.text() : init?.body;
        if (typeof body !== "string")
          throw new Error("Reading command is missing");
        isRead = z
          .object({ isRead: z.boolean() })
          .parse(JSON.parse(body)).isRead;
        return Response.json({
          kind: "saved",
          state: { ...state, isRead, version: 1, readAt: at, updatedAt: at },
          replayed: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    })();
    return () => {
      cleanup();
      router.refresh = originalRefresh;
    };
  },
} satisfies Meta<typeof ProgressRefreshSurface>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OpenAndReadingWriteRefreshRoutes: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        canvasElement.querySelector("[data-material-open-state]"),
      ).toHaveAttribute("data-material-open-state", "saved"),
    );
    const read = within(canvasElement).getByRole("button", { name: "Изучено" });
    await waitFor(() => expect(read).toHaveAttribute("aria-disabled", "false"));
    await userEvent.click(read);
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(2));
    await expect(read).toHaveAttribute("aria-pressed", "true");
  },
};

type Session = "unavailable" | "account A" | "account B" | "guest";

function AccountTransition() {
  const [session, setSession] = useState<Session>("unavailable");
  const accountId =
    session === "guest" || session === "unavailable" ? null : session;
  useAccessChangeRefresh(accountId, session !== "unavailable");
  return (
    <div>
      <output>{session}</output>
      {(["account A", "unavailable", "account B", "guest"] as const).map(
        (next) => (
          <button
            key={next}
            onClick={() => {
              setSession(next);
            }}
          >
            {next}
          </button>
        ),
      )}
    </div>
  );
}

export const KnownAccountChanges: Story = {
  render: () => <AccountTransition />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = async (name: Session) => {
      await userEvent.click(canvas.getByRole("button", { name }));
      await expect(canvas.getByRole("status")).toHaveTextContent(name);
    };
    await expect(canvas.getByRole("status")).toHaveTextContent("unavailable");
    await expect(refreshed).toHaveBeenCalledTimes(0);
    await select("account A");
    await expect(refreshed).toHaveBeenCalledTimes(0);
    await select("unavailable");
    await expect(refreshed).toHaveBeenCalledTimes(0);
    await select("account A");
    await expect(refreshed).toHaveBeenCalledTimes(0);
    await select("unavailable");
    await expect(refreshed).toHaveBeenCalledTimes(0);
    await select("account B");
    await expect(refreshed).toHaveBeenCalledTimes(1);
    await select("guest");
    await expect(refreshed).toHaveBeenCalledTimes(2);
    await select("account A");
    await expect(refreshed).toHaveBeenCalledTimes(3);
  },
};

function Shell({ account, known }: { account: string | null; known: boolean }) {
  useAccessChangeRefresh(account, known);
  return null;
}
export const RouteLifetime: Story = {
  render: () => <div />,
  play: async () => {
    const root = createRoot(document.createElement("div"));

    function mount(account: string | null, known: boolean) {
      flushSync(() => {
        root.render(<Shell account={account} known={known} />);
      });
    }
    const accountA = readingProgressChanges("account-a");
    const accountB = readingProgressChanges("account-b");
    const enrollment = {
      announce: announceEnrollmentChange,
      subscribe: subscribeEnrollmentChange,
    };
    async function check(source: FactAnnouncement, count: number) {
      refreshed.mockClear();
      await deliverAnnouncement(source);
      await expect(refreshed).toHaveBeenCalledTimes(count);
    }
    try {
      mount(null, false);
      await check(accountA, 0);
      await check(currentBillingChanged, 1);
      await check(enrollment, 1);
      mount(null, true);
      await check(accountA, 0);
      mount("account-a", true);
      await check(accountA, 1);
      await check(accountB, 0);
      mount("account-b", true);
      await check(accountA, 0);
      await check(accountB, 1);
      mount("account-b", false);
      await check(accountB, 0);
      flushSync(() => {
        root.render(null);
      });
      for (const source of [
        currentBillingChanged,
        enrollment,
        accountA,
        accountB,
      ])
        await check(source, 0);
      mount("account-b", true);
      for (const source of [currentBillingChanged, enrollment, accountB])
        await check(source, 1);
      flushSync(() => {
        root.render(null);
      });
      await check(accountB, 0);
    } finally {
      root.unmount();
    }
  },
};
