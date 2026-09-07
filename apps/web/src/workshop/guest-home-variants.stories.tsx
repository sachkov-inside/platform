import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { GuestHomePrototype } from "./guest-home.prototype";

const meta = {
  component: GuestHomePrototype,
  title: "Pages/Guest Home/Prototype 380",
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Три варианта гостевой главной #380 на текущих shell, токенах и карточках Platform. A — сначала материалы; B — закреплённая серия с аватаром Кирилла и фильтрами тем; C — авторская практика. Стрелки переключают вариант. Карточки открывают страницы серии, материала и каталога из main на демонстрационных данных; CTA ведёт на текущий экран входа. Баннер B: 224 px на mobile, аватар выступает сверху, значки разработки плавно исчезают; учитывается reduced motion. Содержимое и открытость материалов демонстрационные. Production и платежи не подключены. Решение владельца ожидается." } },
  },
} satisfies Meta<typeof GuestHomePrototype>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MaterialsFirst: Story = { name: "A · Сначала материалы", args: { initialVariant: "A" } };
export const SeriesFirst: Story = {
  name: "B · Серия с аватаром",
  args: { initialVariant: "B" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("link", { name: "Изучить серию" }));
    await expect(canvasElement.querySelector('[data-discovery-kind="series"]')).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Маршрут" })).toBeVisible();
    await userEvent.click(canvas.getByRole("link", { name: "Как дать ИИ контекст своего проекта" }));
    await expect(canvasElement.querySelector('[data-material-reader-state="access-required"]')).toBeInTheDocument();
    await expect(canvas.getByText("Материал 1 из 3")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("link", { name: /^Дальше$/ }));
    await expect(canvas.getByRole("heading", { name: "Границы модулей: где провести линию" })).toBeInTheDocument();
    await expect(canvas.getByText("Материал 2 из 3")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("link", { name: "Назад к серии" }));
    await userEvent.click(canvas.getByRole("link", { name: "Назад на Главную" }));
    await expect(canvas.getByRole("link", { name: "Изучить серию" })).toBeInTheDocument();
  },
};
export const AuthorFirst: Story = { name: "C · От автора", args: { initialVariant: "C" } };
export const Mobile: Story = { name: "Mobile · Все варианты", args: { initialVariant: "B" }, globals: { viewport: { value: "mobile390", isRotated: false } } };
