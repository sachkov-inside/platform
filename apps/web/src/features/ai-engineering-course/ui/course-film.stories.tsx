import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

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

/** Итоговый кадр: так анимацию видит читатель с reduced motion. Запуск — по кнопке. */
export const Poster: Story = {
  args: { autoplay: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: /Продолжить анимацию/u });
    await expect(canvas.getByRole("img")).toHaveAccessibleName(/harness/u);
    await userEvent.click(toggle);
    await expect(
      canvas.getByRole("button", { name: /Пауза анимацию/u }),
    ).toBeVisible();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
