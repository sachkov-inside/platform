import type { RenderedBlock } from "@inside/material-blocks";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { lazy, startTransition, Suspense, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { LessonSteps } from "../model/lesson-steps.client";
import { MaterialBodyView } from "./material-body-view";

const heading = (text: string): RenderedBlock => ({
  kind: "heading",
  level: 2,
  content: [{ kind: "text", text, marks: [] }],
});
const shortLesson: readonly RenderedBlock[] = [
  heading("Начало урока"),
  { kind: "step_break", label: "К примеру" },
  heading("Пример решения"),
];
const extendedLesson: readonly RenderedBlock[] = [
  ...shortLesson,
  { kind: "step_break", label: "К разбору" },
  heading("Разбор решения"),
];

const saveShort = fn<(count: number) => void>();
const saveExtended = fn<(count: number) => void>();
const reachedPendingVersion = fn();

function LessonProgressExample() {
  const [edition, setEdition] = useState<"short" | "pending" | "extended">(
    "short",
  );
  const [saved, setSaved] = useState<number>();
  const [PendingVersion] = useState(() =>
    lazy(() => {
      reachedPendingVersion();
      return Promise.withResolvers<{ default: () => null }>().promise;
    }),
  );
  const short = edition === "short";
  const blocks = short ? shortLesson : extendedLesson;
  return (
    <>
      <button
        onClick={() => {
          startTransition(() => {
            setEdition("pending");
          });
        }}
      >
        Загрузить новую редакцию
      </button>
      <button
        onClick={() => {
          setEdition("extended");
        }}
      >
        Показать новую редакцию
      </button>
      <button
        onClick={() => {
          setSaved(2);
        }}
      >
        Получить сохранённую часть 2
      </button>
      <button
        onClick={() => {
          setSaved(9);
        }}
      >
        Получить сохранённую часть 9
      </button>
      <Suspense fallback={<span>Загрузка урока</span>}>
        <LessonSteps
          blocks={blocks}
          progress={{ saved, save: short ? saveShort : saveExtended }}
          reader={{ name: "Вы", avatar: null }}
        >
          <MaterialBodyView
            blocks={blocks}
            rendering={{
              headingId: (path) => `lesson-heading-${path.join("-")}`,
              image: () => null,
              file: () => null,
            }}
            path={[]}
          />
          {edition === "pending" && <PendingVersion />}
        </LessonSteps>
      </Suspense>
    </>
  );
}

const meta = {
  component: LessonProgressExample,
  title: "Components/Material/Lesson progress",
  beforeEach: () => {
    saveShort.mockClear();
    saveExtended.mockClear();
    reachedPendingVersion.mockClear();
  },
} satisfies Meta<typeof LessonProgressExample>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Actions on the visible edition use its progress command and its actual part count. */
export const OpenWhileEditionChanges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const press = (name: string) =>
      userEvent.click(canvas.getByRole("button", { name }));
    await press("Загрузить новую редакцию");
    await waitFor(() => expect(reachedPendingVersion).toHaveBeenCalled());
    await press("К примеру");
    await expect(saveShort.mock.calls).toEqual([[2]]);
    await expect(saveExtended.mock.calls).toEqual([]);
    await press("Показать новую редакцию");
    const target = canvas.getByText("Разбор решения", { selector: "h2" });
    await expect(target).not.toBeVisible();
    const previousUrl = window.location.href;
    try {
      const address = new URL(previousUrl);
      address.hash = target.id;
      window.location.replace(address);
      await waitFor(() => expect(target).toBeVisible());
      await expect(saveExtended.mock.calls).toEqual([[3]]);
      await press("Получить сохранённую часть 2");
      await expect(target).toBeVisible();
      await expect(saveShort.mock.calls).toEqual([[2]]);
      await expect(saveExtended.mock.calls).toEqual([[3]]);
    } finally {
      window.history.replaceState(window.history.state, "", previousUrl);
    }
  },
};

/** Restoring an old, longer edition cannot silently open content that arrives afterwards. */
export const RestoreWithinCurrentEdition: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const press = (name: string) =>
      userEvent.click(canvas.getByRole("button", { name }));
    await press("Получить сохранённую часть 9");
    await expect(
      canvas.getByText("Пример решения", { selector: "h2" }),
    ).toBeVisible();
    await press("Показать новую редакцию");
    await expect(
      canvas.getByRole("button", { name: "К разбору" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Разбор решения", { selector: "h2" }),
    ).not.toBeVisible();
    await press("Получить сохранённую часть 2");
    await press("Получить сохранённую часть 9");
    await expect(
      canvas.getByRole("button", { name: "К разбору" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Разбор решения", { selector: "h2" }),
    ).not.toBeVisible();
    await expect(saveShort.mock.calls).toEqual([]);
    await expect(saveExtended.mock.calls).toEqual([]);
  },
};
