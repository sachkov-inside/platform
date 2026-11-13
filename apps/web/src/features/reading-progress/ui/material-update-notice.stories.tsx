import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { getQueryClient } from "@/shared/api/query-client";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { MaterialUpdateNotice } from "./material-update-notice.client";
import { ReadingProgressProvider } from "./reading-provider.client";
import { VisibleMaterialOpen } from "./visible-material-open.client";

const accountId = "20000000-0000-4000-8000-000000002125";
const materialId = "10000000-0000-4000-8000-000000002125";
const at = "2026-10-10T08:00:00.000Z";
const environment = publicPageEnvironment("/materials/course-intro", {
  account: "authenticated",
});
/** Requests in the order the page sent them. */
const requests: string[] = [];
let opened = false;
let releaseStates: (() => void) | undefined;

function OpenedLesson() {
  return (
    <ReadingProgressProvider accountId={accountId} resolved>
      <VisibleMaterialOpen materialId={materialId} contentVersion={2}>
        <h1>Как собрать промпт</h1>
        <MaterialUpdateNotice materialId={materialId} />
      </VisibleMaterialOpen>
    </ReadingProgressProvider>
  );
}

const meta = {
  ...environment,
  id: "features-reading-progress-update-notice",
  title: "Components/Material/Update notice",
  component: OpenedLesson,
  beforeEach: () => {
    getQueryClient().clear();
    environment.beforeEach();
    requests.length = 0;
    opened = false;
    releaseStates = undefined;
    return fetchBeforeRender(async (input) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      ).pathname;
      if (path.startsWith("/api/reading-progress/")) requests.push(path);
      if (path === "/api/reading-progress/states") {
        // The first read waits for the story, so it can show the open waits for it.
        if (!opened)
          await new Promise<void>((resolve) => {
            releaseStates = resolve;
          });
        return Response.json({
          kind: "ready",
          states: [
            {
              materialId,
              isRead: true,
              version: 1,
              readAt: at,
              updatedAt: at,
              // The open clears the note on the server.
              updateNote: opened
                ? null
                : {
                    whatChanged: "Переписан раздел о сборке промпта.",
                    notedAt: "2026-10-12T08:00:00.000Z",
                  },
              openedParts: null,
            },
          ],
        });
      }
      if (path === "/api/reading-progress/open") {
        opened = true;
        return Response.json({ kind: "saved", openedAt: at, replayed: false });
      }
      throw new Error(`Unexpected request: ${path}`);
    })();
  },
} satisfies Meta<typeof OpenedLesson>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The reader studied the lesson before a substantial update (#2125). The open waits for the
 * reading state, so the banner reads the note first; after the open the note is gone on the
 * server and the banner stays for this page.
 */
export const OpenWaitsForTheNote: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(releaseStates).toBeDefined());
    await expect(requests).not.toContain("/api/reading-progress/open");
    releaseStates?.();
    await waitFor(() =>
      expect(
        canvasElement.querySelector("[data-material-open-state]"),
      ).toHaveAttribute("data-material-open-state", "saved"),
    );
    await expect(requests.indexOf("/api/reading-progress/states")).toBeLessThan(
      requests.indexOf("/api/reading-progress/open"),
    );
    await waitFor(() =>
      expect(
        getQueryClient().getQueryData([
          "reading-progress",
          accountId,
          "material",
          materialId,
        ]),
      ).toMatchObject({ updateNote: null }),
    );
    await expect(
      canvasElement.querySelector("[data-material-update-notice]"),
    ).toHaveTextContent(
      "Урок обновлён после того, как ты его изучил: Переписан раздел о сборке промпта.",
    );
  },
};
