import { Activity } from "react";
import { expect, waitFor, within } from "storybook/test";
import { z } from "zod";
import { committedRoot } from "@/storybook/committed-root";
import { CourseRail } from "./course-reading.client";
import { courseGuide } from "@/storybook/course-reading.fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReaderHistoryTracker } from "@/shared/ui/reader-history.client";

const meta = { title: "Patterns/Reader/History tracker" };
export default meta;
export const RestoresOwnVisibleEntry = {
  render: () => <div />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = document.createElement("section");
    canvasElement.append(host);
    const root = committedRoot(host);
    const url = location.href,
      state: unknown = history.state;
    const path = "/materials/reader-history-contract";
    const cache = new QueryClient();
    const first = courseGuide.chapters.find(
      (chapter) => chapter.id === courseGuide.currentChapterId,
    );
    const other = courseGuide.chapters.find(
      (chapter) => chapter.id !== courseGuide.currentChapterId,
    );
    if (!first || !other) throw new Error("Expected two course chapters");
    let entryKey: string | undefined;
    function paint(mode: "visible" | "hidden", chapter: string, route = path) {
      root.show(
        <>
          <div data-material-id="other">
            <div data-course-chapter="foreign" />
          </div>
          <QueryClientProvider client={cache}>
            <Activity mode={mode}>
              <section data-material-id="owned">
                <CourseRail
                  context={{ ...courseGuide, currentChapterId: chapter }}
                />
                <div
                  data-application-content
                  style={{ height: 80, overflow: "auto" }}
                >
                  <div style={{ height: 700 }} />
                </div>
                <ReaderHistoryTracker path={route} />
              </section>
            </Activity>
          </QueryClientProvider>
        </>,
      );
    }
    const content = () => {
      const element = host.querySelector<HTMLElement>(
        "[data-application-content]",
      );
      if (!element) throw new Error("Missing reader scroll container");
      return element;
    };
    try {
      history.replaceState(null, "", path);
      paint("visible", first.id, "/another");
      await expect(history.state).toBe(null);
      paint("visible", first.id);
      const entry = z
        .object({ insideReader: z.object({ id: z.string() }) })
        .parse(history.state);
      entryKey = "inside-reader-entry:" + entry.insideReader.id;
      content().scrollTop = 127;
      window.dispatchEvent(new Event("pagehide"));
      paint("visible", other.id);
      content().scrollTop = 210;
      content().dispatchEvent(new Event("scroll"));
      paint("hidden", other.id);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          resolve();
        }),
      );
      window.dispatchEvent(new Event("pagehide"));
      paint("visible", other.id);
      history.replaceState(history.state, "", path + "?other=1");
      window.dispatchEvent(new Event("pagehide"));
      history.replaceState(history.state, "", path);
      content().scrollTop = 0;
      window.dispatchEvent(new PopStateEvent("popstate"));
      await waitFor(() =>
        expect(
          within(host).getByRole("button", { name: new RegExp(first.name) }),
        ).toBeVisible(),
      );
      await expect(content().scrollTop).toBe(127);
    } finally {
      root.unmount();
      host.remove();
      if (entryKey !== undefined) sessionStorage.removeItem(entryKey);
      history.replaceState(state, "", url);
      cache.clear();
    }
  },
};
