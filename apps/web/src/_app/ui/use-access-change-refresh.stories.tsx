import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
  ReadingProgressProvider,
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
  useAccessChangeRefresh(accountId, true);
  return (
    <ReadingProgressProvider accountId={accountId} resolved>
      <VisibleMaterialOpen materialId={materialId} contentVersion={1}>
        <h1>Урок открыт</h1>
        <SavedReadingAction materialId={materialId} format="guide" />
      </VisibleMaterialOpen>
    </ReadingProgressProvider>
  );
}
const meta = {
  ...environment,
  title: "App/Personal navigation refresh",
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
        return Response.json({ kind: "ready", states: [state] });
      if (path === "/api/reading-progress/open")
        return Response.json({ kind: "saved", openedAt: at, replayed: false });
      if (path === "/api/reading-progress/state") {
        const form =
          input instanceof Request ? await input.formData() : init?.body;
        if (!(form instanceof FormData))
          throw new Error("Reading command is missing");
        isRead = form.get("isRead") === "true";
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
    const read = within(canvasElement).getByRole("button", { name: "Изучено" });
    await waitFor(() => expect(read).toHaveAttribute("aria-disabled", "false"));
    await userEvent.click(read);
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(2));
    await expect(read).toHaveAttribute("aria-pressed", "true");
  },
};
