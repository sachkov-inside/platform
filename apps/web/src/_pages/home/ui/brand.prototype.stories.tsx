import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandPrototype } from "./brand.prototype";

const meta = {
  title: "Pages/Brand/Sachkov Inside",
  component: BrandPrototype,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Владелец выбрал верхнюю шапку A. Здесь отдельно сравниваем логотип и точное название Sachkov Inside. Три SVG направления и их применение в выбранной шапке. Production-интеграция следует после выбора знака.",
      },
    },
  },
} satisfies Meta<typeof BrandPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LogoBoard: Story = {
  name: "Все логотипы",
  args: { initialView: "board" },
};
export const MonogramHeader: Story = {
  name: "A · SI в шапке",
  args: { initialView: "header", initialDirection: "monogram" },
};
export const FrameHeader: Story = {
  name: "B · Рамка в шапке",
  args: { initialView: "header", initialDirection: "frame" },
};
export const TypeHeader: Story = {
  name: "C · Название в шапке",
  args: { initialView: "header", initialDirection: "type" },
};
export const MobileMonogram: Story = {
  name: "Телефон · SI",
  args: { initialView: "header", initialDirection: "monogram" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const MobileFrame: Story = {
  name: "Телефон · рамка",
  args: { initialView: "header", initialDirection: "frame" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const MobileType: Story = {
  name: "Телефон · название",
  args: { initialView: "header", initialDirection: "type" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
