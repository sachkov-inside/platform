import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { CourseFilm } from "./course-film.client";

const meta = {
  component: CourseFilm,
  title: "Features/Guide/AI Engineering film",
  parameters: { layout: "padded" },
  render: (args) => (
    <div style={{ width: "min(560px, calc(100vw - 32px))" }}>
      <CourseFilm {...args} />
    </div>
  ),
} satisfies Meta<typeof CourseFilm>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Проигрывание в слоте первого экрана курса. */
export const Autoplay: Story = {};

/** Итоговый кадр: так анимацию видит читатель с reduced motion. Кнопки паузы нет. */
export const Poster: Story = {
  args: { autoplay: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("img")).toHaveAccessibleName(/harness/u);
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
