import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, waitFor } from "storybook/test";

import { getQueryClient } from "@/shared/api/query-client";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { MaterialUpdateNotice } from "./material-update-notice.client";
import { ReadingProgressProvider } from "./reading-provider.client";
import { VisibleMaterialOpen } from "./visible-material-open.client";
import {
  materialOpenCommandSchema,
  type MaterialOpenCommand,
} from "../model/material-open-contract";

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

function createViewportOpenFlow() {
  const queryClient = new QueryClient();
  const statesBarrier = Promise.withResolvers<undefined>();
  const requests: string[] = [];
  const commands: MaterialOpenCommand[] = [];
  let opened = false;
  return {
    queryClient,
    requests,
    commands,
    releaseStates: () => {
      statesBarrier.resolve(undefined);
    },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      ).pathname;
      requests.push(path);
      if (path === "/api/reading-progress/states") {
        if (!opened) await statesBarrier.promise;
        return Response.json({
          kind: "ready",
          states: [
            {
              materialId,
              isRead: true,
              version: 1,
              readAt: at,
              updatedAt: at,
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
        const body: unknown =
          input instanceof Request
            ? await input.clone().json()
            : typeof init?.body === "string"
              ? JSON.parse(init.body)
              : undefined;
        commands.push(materialOpenCommandSchema.parse(body));
        opened = true;
        return Response.json({ kind: "saved", openedAt: at, replayed: false });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  };
}
let viewportOpenFlow = createViewportOpenFlow();

export const OpenWaitsForViewportAfterStates: Story = {
  beforeEach: () => {
    viewportOpenFlow = createViewportOpenFlow();
    const flow = viewportOpenFlow;
    const restore = fetchBeforeRender(flow.fetch)();
    return () => {
      flow.releaseStates();
      flow.queryClient.clear();
      restore();
    };
  },
  render: () => (
    <QueryClientProvider client={viewportOpenFlow.queryClient}>
      <div style={{ paddingBlockStart: "200vh" }}>
        <OpenedLesson />
      </div>
    </QueryClientProvider>
  ),
  play: async ({ canvasElement }) => {
    const flow = viewportOpenFlow;
    const reader = canvasElement.querySelector<HTMLDivElement>(
      "[data-material-open-state]",
    );
    if (reader === null) throw new Error("Missing viewport Reader fixture");
    let entry: IntersectionObserverEntry | undefined;
    // A second native observer only records geometry; the production observer is unchanged.
    const observer = new IntersectionObserver((entries) => {
      entry = entries[0];
    });
    observer.observe(reader);
    const geometry = () => ({
      top: reader.getBoundingClientRect().top,
      bottom: reader.getBoundingClientRect().bottom,
      rootBottom: entry?.rootBounds?.bottom ?? null,
      intersecting: entry?.isIntersecting ?? null,
      documentVisibility: document.visibilityState,
    });
    const key = ["reading-progress", accountId, "material", materialId];
    try {
      await waitFor(() =>
        expect(flow.requests).toContain("/api/reading-progress/states"),
      );
      await waitFor(() => expect(entry?.isIntersecting).toBe(false));
      flow.releaseStates();
      await waitFor(() =>
        expect(flow.queryClient.getQueryData(key)).toMatchObject({
          materialId,
          isRead: true,
          version: 1,
          updateNote: {
            whatChanged: "Переписан раздел о сборке промпта.",
          },
        }),
      );
      const offscreen = geometry();
      if (offscreen.rootBottom === null)
        throw new Error("Native viewport bounds unavailable");
      await expect(offscreen.top).toBeGreaterThan(offscreen.rootBottom);
      await expect(offscreen.intersecting).toBe(false);
      await expect(offscreen.documentVisibility).toBe("visible");
      await expect(flow.requests).not.toContain("/api/reading-progress/open");
      await expect(reader).toHaveAttribute("data-material-open-state", "idle");

      // One native DOM scroll; no clock, observer or document visibility replacement.
      reader.scrollIntoView({ block: "center" });
      await waitFor(() => expect(entry?.isIntersecting).toBe(true));
      await waitFor(() =>
        expect(reader).toHaveAttribute("data-material-open-state", "saved"),
      );
      await expect(flow.commands).toHaveLength(1);
      await expect(flow.commands[0]).toMatchObject({
        materialId,
        contentVersion: 2,
      });
      await expect(flow.commands[0]?.commandId).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u,
      );
      await expect(
        flow.requests.indexOf("/api/reading-progress/states"),
      ).toBeLessThan(flow.requests.indexOf("/api/reading-progress/open"));
      await waitFor(() =>
        expect(flow.queryClient.getQueryData(key)).toMatchObject({
          updateNote: null,
        }),
      );
      await expect(
        canvasElement.querySelector("[data-material-update-notice]"),
      ).toHaveTextContent(
        "Урок обновлён после того, как ты его изучил: Переписан раздел о сборке промпта.",
      );
      console.info(
        "reader-open-geometry",
        JSON.stringify({
          offscreen,
          afterScroll: geometry(),
          commands: flow.commands,
          requests: flow.requests,
        }),
      );
    } finally {
      observer.disconnect();
      flow.releaseStates();
    }
  },
};
