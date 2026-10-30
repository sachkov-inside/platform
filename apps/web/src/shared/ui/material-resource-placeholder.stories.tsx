import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { MaterialResourcePlaceholder } from "./material-resource-placeholder";

const meta = {
  ...publicPageEnvironment("/materials/agent-setup"),
  title: "Components/Material/Unavailable resource",
  component: MaterialResourcePlaceholder,
  args: {
    kind: "image",
    alt: "Схема работы агента",
    caption: "Путь от задачи к проверке результата",
  },
  parameters: {
    docs: {
      description: {
        component:
          "Общее обозначение недоступного изображения или файла в Reader и точном предпросмотре материала.",
      },
    },
  },
} satisfies Meta<typeof MaterialResourcePlaceholder>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Image: Story = {
  args: { kind: "image", alt: "Схема работы агента" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("img", { name: "Схема работы агента" }),
    ).toBeVisible();
    await expect(
      within(canvasElement).getByText("Путь от задачи к проверке результата"),
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
