import { useState } from "react";
import { flushSync } from "react-dom";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { courseGuide } from "@/storybook/course-reading.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";
import {
  enterReaderHistory,
  readerHistoryRestoreEvent,
  resetReaderHistoryActivation,
  saveReaderHistoryView,
} from "@/shared/lib/reader-history";
import { CourseRail } from "./course-reading.client";

const meta = {
  ...publicPageEnvironment("/materials/course-intro"),
  title: "Patterns/Product/Course rail history",
  tags: ["!dev", "!autodocs"],
};
export default meta;

const remaining = {
  ...courseGuide,
  chapters: courseGuide.chapters.filter(
    (chapter) => chapter.id === courseGuide.currentChapterId,
  ),
};

export const ReplacedRailOwnsAvailableChapters = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  render: function RailReplacement() {
    const [original, setOriginal] = useState(true);
    const [replacement, setReplacement] = useState(false);
    const [sheet, setSheet] = useState(false);
    return (
      <>
        <button
          onClick={() => {
            setReplacement(!replacement);
          }}
        >
          Сменить панель
        </button>
        <button
          onClick={() => {
            setOriginal(false);
          }}
        >
          Убрать прежнюю панель
        </button>
        <button
          onClick={() => {
            setSheet(!sheet);
          }}
        >
          {sheet ? "Закрыть список" : "Открыть список в диалоге"}
        </button>
        <section
          aria-label="Материал"
          data-material-id="course-rail-history"
          data-application-content
          style={{ height: 180, overflow: "auto" }}
        >
          {original && <CourseRail context={courseGuide} />}
          {replacement && <CourseRail context={remaining} />}
          {sheet && <CourseRail context={courseGuide} variant="sheet" />}
          <div style={{ height: 800 }} />
        </section>
      </>
    );
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    // enterReaderHistory installs document-lifetime preservation. The Vitest preload gives this file its own iframe.
    if (import.meta.env.MODE !== "test") return;
    const canvas = within(canvasElement);
    const reader = canvas.getByRole("region", { name: "Материал" });
    const chapter = courseGuide.chapters.find(
      (item) => item.id !== courseGuide.currentChapterId,
    );
    if (!chapter) throw new Error("Expected a second chapter");
    const previousState: unknown = history.state;
    const id = crypto.randomUUID();
    const storageKey = "inside-reader-entry:" + id;
    try {
      history.replaceState({ insideReader: { id, href: location.href } }, "");
      enterReaderHistory(undefined, reader);
      const rail = within(reader).getByRole("complementary", {
        name: "Текущая глава",
      });
      const restore = (detail: string) => {
        flushSync(() => {
          window.dispatchEvent(
            new CustomEvent(readerHistoryRestoreEvent, { detail }),
          );
        });
      };
      restore("missing-chapter");
      await expect(rail).toHaveAttribute(
        "data-course-chapter",
        courseGuide.currentChapterId,
      );
      restore(chapter.id);
      await waitFor(() =>
        expect(
          within(rail).getByRole("button", { name: new RegExp(chapter.name) }),
        ).toBeVisible(),
      );
      reader.scrollTop = 110;
      saveReaderHistoryView(reader);
      restore(courseGuide.currentChapterId);
      await expect(rail).toHaveAttribute(
        "data-course-chapter",
        courseGuide.currentChapterId,
      );
      reader.scrollTop = 0;
      resetReaderHistoryActivation();
      enterReaderHistory(undefined, reader);
      await waitFor(() =>
        expect(
          within(rail).getByRole("button", { name: new RegExp(chapter.name) }),
        ).toBeVisible(),
      );
      await waitFor(() => expect(reader.scrollTop).toBe(110));
      await userEvent.click(
        canvas.getByRole("button", { name: "Сменить панель" }),
      );
      await userEvent.click(
        canvas.getByRole("button", { name: "Открыть список в диалоге" }),
      );
      await userEvent.click(
        canvas.getByRole("button", { name: "Убрать прежнюю панель" }),
      );
      reader.scrollTop = 0;
      resetReaderHistoryActivation();
      enterReaderHistory(undefined, reader);
      await expect(reader.scrollTop).toBe(110);
      await expect(within(reader).getByRole("complementary")).toHaveAttribute(
        "data-course-chapter",
        courseGuide.currentChapterId,
      );

      await userEvent.click(
        canvas.getByRole("button", { name: "Сменить панель" }),
      );
      reader.scrollTop = 0;
      resetReaderHistoryActivation();
      enterReaderHistory(undefined, reader);
      await expect(reader.scrollTop).toBe(0);
      await userEvent.click(
        canvas.getByRole("button", { name: "Сменить панель" }),
      );
      await waitFor(() => expect(reader.scrollTop).toBe(110));
      await userEvent.click(
        canvas.getByRole("button", { name: "Закрыть список" }),
      );
    } finally {
      resetReaderHistoryActivation();
      sessionStorage.removeItem(storageKey);
      history.replaceState(previousState, "");
    }
  },
};
