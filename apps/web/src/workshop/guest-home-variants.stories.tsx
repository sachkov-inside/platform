import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { GuestHomePrototype } from "./guest-home.prototype";

const meta = {
  component: GuestHomePrototype,
  title: "Pages/Guest Home/Prototype 380",
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Три варианта гостевой главной #380 на текущих shell, токенах и карточках Platform. A — сначала материалы; B — закреплённая серия с аватаром Кирилла и настоящая главная из main: серии, темы, видео, гайды и заметки; C — авторская практика. Стрелки переключают вариант. Карточки открывают страницы серии, материала и каталога из main на демонстрационных данных; CTA ведёт на текущий экран входа. Основная поза B — спокойный портрет; второй вариант — парящий объект. Объясняющий жест убран из сравнения. Мобильная кнопка справа, нижняя навигация — только иконки. Кандидат мобильной типографики: основной текст 16 px, разделы 18 px, страницы 24 px, заголовки 600. Баннер растёт при увеличении текста. Значки разработки вылетают по очереди от плеча примерно раз в секунду; учитывается reduced motion. Содержимое и открытость материалов демонстрационные. Production и платежи не подключены. Решение владельца ожидается." } },
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
    const sectionNames = Array.from(canvasElement.querySelectorAll("section[aria-labelledby]"), (section) => section.getAttribute("aria-labelledby"));
    await expect(sectionNames).toEqual(["featured-title", "home-series", "home-videos", "home-guides", "home-notes", "home-catalog"]);
    await userEvent.click(canvas.getByRole("link", { name: "Все видео" }));
    await expect(canvas.getByRole("heading", { name: "База знаний" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "От задачи до работающего кода с ИИ" })).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "Что проверять в CI до деплоя" })).not.toBeInTheDocument();
    const homeLinks = canvas.getAllByRole("link", { name: "Главная" });
    const homeLink = homeLinks.find((link) => link.getBoundingClientRect().width > 0);
    if (!homeLink) throw new Error("Home navigation is missing");
    await userEvent.click(homeLink);
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

export const AvatarPortrait: Story = { name: "B1 · Спокойный портрет", args: { initialVariant: "B", initialAvatarPose: "portrait" } };
export const AvatarObject: Story = { name: "B2 · Парящий объект", args: { initialVariant: "B", initialAvatarPose: "object" } };

export const MobileTypeScale: Story = {
  name: "Mobile · Шкала шрифтов",
  render: () => <div className="mobile-type-specimen">
    <h1 data-type="page">Мобильная типографика Inside</h1>
    <p data-type="body">Компактные заголовки, обычная насыщенность текста и ясные роли. Manrope остаётся основным шрифтом.</p>
    {[
      ["page", "Страница · 24 / 30 · 600", "Создаём реальный продукт с ИИ"],
      ["section", "Раздел и компактный баннер · 18 / 24 · 600", "Гайды и разборы"],
      ["card", "Карточка · 16 / 22 · 600", "Границы модулей: где провести линию"],
      ["body", "Основной текст · 16 / 24 · 400", "Разбираем задачу, сравниваем решения и проверяем результат на своём проекте."],
      ["ui", "Интерфейс · 14 / 20 · 500; кнопки · 600", "Изучить серию · Разработка с ИИ"],
      ["meta", "Метаданные · 12 / 16 · 500", "Гайд · 10 минут · Инфраструктура"],
    ].map(([role, label, text]) => <section key={role}><small>{label}</small><p data-type={role}>{text}</p></section>)}
  </div>,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const MobileTextZoom: Story = {
  name: "Mobile · Текст 200%",
  args: { initialVariant: "B", initialAvatarPose: "portrait" },
  decorators: [(Story) => <TextPreferences zoom><Story /></TextPreferences>],
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: checkReadableBanner,
};
export const MobileTextSpacing: Story = {
  name: "Mobile · Пользовательские интервалы",
  args: { initialVariant: "B", initialAvatarPose: "portrait" },
  decorators: [(Story) => <TextPreferences><Story /></TextPreferences>],
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: checkReadableBanner,
};
function TextPreferences({ zoom = false, children }: { readonly zoom?: boolean; readonly children: ReactNode }) {
  useEffect(() => {
    if (!zoom) return;
    const root = document.documentElement;
    const before = root.style.fontSize;
    root.style.fontSize = "200%";
    return () => { root.style.fontSize = before; };
  }, [zoom]);
  return <div className={zoom ? undefined : "gh-user-text-spacing"}>{children}</div>;
}
async function checkReadableBanner({ canvasElement }: { canvasElement: HTMLElement }) {
  const canvas = within(canvasElement);
  await new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
  const title = canvas.getByRole("heading", { name: "Создаём реальный продукт с ИИ" });
  const button = canvas.getByRole("link", { name: "Изучить серию" });
  await expect(title).toBeVisible();
  await expect(button).toBeVisible();
  await expect(title.getBoundingClientRect().bottom).toBeLessThanOrEqual(button.getBoundingClientRect().top);
  const doc = canvasElement.ownerDocument;
  await expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual((doc.defaultView?.innerWidth ?? 0) + 1);
  const dock = canvas.getByRole("navigation", { name: "Мобильная навигация" });
  if (dock.getBoundingClientRect().height > 0) {
    await expect(dock.getBoundingClientRect().height).toBeLessThan(120);
  }
}
