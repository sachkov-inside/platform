import type { Meta, StoryObj } from "@storybook/react-vite";

import { NavigationPrototype } from "./navigation.prototype";

const meta = {
  title: "Pages/Navigation/Prototype 311",
  component: NavigationPrototype,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Три варианта навигации на текущей главной. A: верхняя шапка. B: короткая панель с подписями, вход сверху справа. C: полный сайдбар, вход сразу под логотипом. Внизу — переключатель и условия сравнения: 2/5 разделов, якоря главной, гость/участник. Будущие разделы — макеты; реальные вход и переходы не выполняются. Решение владельца по #311 пока открыто.",
      },
    },
  },
} satisfies Meta<typeof NavigationPrototype>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Header: Story = {
  name: "A · Верхняя шапка",
  args: { initialVariant: "header" },
};
export const Compact: Story = {
  name: "B · Короткая панель",
  args: { initialVariant: "compact" },
};
export const Sidebar: Story = {
  name: "C · Полный сайдбар",
  args: { initialVariant: "sidebar" },
};
export const FutureSections: Story = {
  name: "Рост · 5 разделов",
  args: { initialVariant: "sidebar", initialExpanded: true },
};
export const MobileHeader: Story = {
  name: "Телефон · шапка",
  args: { initialVariant: "header", initialExpanded: true },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const MobileCompact: Story = {
  name: "Телефон · нижняя панель",
  args: { initialVariant: "compact", initialExpanded: true },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
