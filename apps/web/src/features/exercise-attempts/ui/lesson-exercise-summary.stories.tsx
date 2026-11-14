import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { expectPhoneLayout } from "@/storybook/phone-layout";

import { LessonExerciseSummary } from "./lesson-exercise-summary";

const meta = {
  id: "features-lesson-exercise-summary",
  title: "Components/Material/Lesson exercise summary",
  component: LessonExerciseSummary,
  args: {
    total: 4,
    solved: 2,
    unsolved: [
      { id: "rag-wrong-platform", number: 2, fingerprint: "669258ca11c32c41" },
      { id: "pipeline", number: 4, fingerprint: "fedf00a6d2dab0fb" },
    ],
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[43rem] bg-lesson-surface p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LessonExerciseSummary>;
export default meta;
type Story = StoryObj<typeof meta>;

/** WCAG relative luminance of a computed `rgb(...)` colour. */
function luminance(color: string): number {
  const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/gu) ?? []).map(Number);
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** Each dot stands out from the sand card: solved ones filled graphite, open ones outlined. */
async function expectVisibleMarkers(canvasElement: HTMLElement) {
  const surface = getComputedStyle(
    canvasElement.querySelector(".bg-lesson-surface") ?? canvasElement,
  ).backgroundColor;
  for (const marker of canvasElement.querySelectorAll<HTMLElement>(
    "[data-lesson-exercise-marker]",
  )) {
    const style = getComputedStyle(marker);
    await expect(marker.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      10,
    );
    if (marker.dataset["lessonExerciseMarker"] === "solved") {
      await expect(
        contrast(style.backgroundColor, surface),
      ).toBeGreaterThanOrEqual(3);
    } else {
      await expect(
        Number.parseFloat(style.borderTopWidth),
      ).toBeGreaterThanOrEqual(1.5);
      await expect(
        contrast(style.borderTopColor, surface),
      ).toBeGreaterThanOrEqual(3);
    }
  }
}

/** One quiet row: a dot per exercise, solved ones filled, and a link to the first unsolved one. */
export const SomeUnsolved: Story = {
  play: async ({ canvasElement }) => {
    const summary = within(canvasElement);
    await expect(summary.getByText("Упражнения: 2 из 4")).toBeVisible();
    await expect(summary.getAllByRole("link")).toHaveLength(1);
    await expect(
      summary.getByRole("link", { name: "Решить упражнение 2" }),
    ).toHaveAttribute("href", "#exercise-rag-wrong-platform");
    await expect(
      [...canvasElement.querySelectorAll("[data-lesson-exercise-marker]")].map(
        (marker) => marker.getAttribute("data-lesson-exercise-marker"),
      ),
    ).toEqual(["solved", "open", "solved", "open"]);
    await expectVisibleMarkers(canvasElement);
  },
};

export const AllSolved: Story = {
  args: { total: 3, solved: 3, unsolved: [] },
  play: async ({ canvasElement }) => {
    const summary = within(canvasElement);
    await expect(summary.getByText("Упражнения: 3 из 3")).toBeVisible();
    await expect(summary.queryAllByRole("link")).toHaveLength(0);
  },
};

export const Phone360: Story = {
  globals: { viewport: { value: "mobile360", isRotated: false } },
  args: {
    total: 8,
    solved: 5,
    unsolved: [
      { id: "a", number: 3, fingerprint: "a" },
      { id: "b", number: 6, fingerprint: "b" },
      { id: "c", number: 7, fingerprint: "c" },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("link", { name: "Решить упражнение 3" }),
    ).toBeVisible();
    await expectPhoneLayout(canvasElement, "[data-lesson-exercise-summary]");
  },
};
