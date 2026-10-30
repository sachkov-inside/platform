import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MaterialResourcePlaceholder } from "./material-resource-placeholder";

const meta = {
  title: "Components/Material/Unavailable resource",
  component: MaterialResourcePlaceholder,
  args: {
    kind: "image",
    alt: "Схема работы агента",
  },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[60rem] px-4 sm:px-8">
        <div className="mx-auto w-full max-w-[46rem] bg-card px-10 sm:px-12">
          <Story />
        </div>
      </div>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Заглушка изображения или файла внутри импортированного квиза в редакторе материала. Использует тему авторской части и ширину области редактирования.",
      },
    },
  },
} satisfies Meta<typeof MaterialResourcePlaceholder>;
export default meta;
type Story = StoryObj<typeof MaterialResourcePlaceholder>;
export const Image: Story = {
  args: { kind: "image", alt: "Схема работы агента" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("img", { name: "Схема работы агента" }),
    ).toBeVisible();
  },
};
export const File: Story = {
  args: { kind: "file", label: "Чек-лист настройки проекта" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Файл пока недоступен для скачивания"),
    ).toBeVisible();
  },
};
export const Mobile: Story = {
  ...Image,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
