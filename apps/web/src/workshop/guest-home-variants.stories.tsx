import type { Meta, StoryObj } from "@storybook/react-vite";
import { GuestHomePrototype } from "./guest-home.prototype";

const meta = {
  component: GuestHomePrototype,
  title: "Pages/Guest Home/Prototype 380",
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Три варианта гостевой главной #380 на текущих shell, токенах и карточках Platform. A — сначала материалы; B — закреплённая серия с аватаром Кирилла и фильтрами тем; C — авторская практика. Стрелки снизу переключают вариант. Карточки открывают пример материала или серии, CTA — демонстрационный экран подписки. Содержимое и открытость материалов демонстрационные. Production и платежи не подключены. Решение владельца ожидается." } },
  },
} satisfies Meta<typeof GuestHomePrototype>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MaterialsFirst: Story = { name: "A · Сначала материалы", args: { initialVariant: "A" } };
export const SeriesFirst: Story = { name: "B · Серия с аватаром", args: { initialVariant: "B" } };
export const AuthorFirst: Story = { name: "C · От автора", args: { initialVariant: "C" } };
export const Mobile: Story = { name: "Mobile · Все варианты", args: { initialVariant: "A" }, globals: { viewport: { value: "mobile390", isRotated: false } } };
