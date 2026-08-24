import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "Библиотека" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

const meta = {
  args: {
    accountLabel: "Кирилл",
    children: null,
    currentPath: "/",
    navigationItems,
    sidebarDefaultPinned: true,
  },
  argTypes: {
    currentPath: {
      control: "select",
      options: ["/", "/library", "/map"],
    },
  },
  component: ApplicationShell,
  parameters: {
    docs: {
      description: {
        component:
          "Принятая navigation topology Platform: desktop sidebar раскрывается по hover/focus и может быть закреплён, а mobile сохраняет постоянную нижнюю навигацию.",
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
  render: ({ children, ...args }) => {
    void children;

    return (
      <ApplicationShell {...args}>
        <HomeShellFixture />
      </ApplicationShell>
    );
  },
  title: "Patterns/Navigation/Application shell",
} satisfies Meta<typeof ApplicationShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SidebarExpanded: Story = {
  name: "Desktop pinned sidebar",
  args: {
    sidebarDefaultPinned: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const storyWindow = canvasElement.ownerDocument.defaultView;
    const fixture = canvasElement.querySelector("[data-fixture='synthetic-navigation-proof']");
    const main = canvas.getByRole("main");
    const sidebar = canvas.getByRole("complementary", { name: "Боковая панель" });
    const contents = sidebar.firstElementChild;
    const account = canvas.getByRole("group", { name: "Текущий профиль: Кирилл" });

    if (storyWindow === null || fixture === null || contents === null) {
      throw new Error("Scrollable sidebar fixture is incomplete");
    }

    const spacer = storyWindow.document.createElement("div");
    spacer.style.height = "40rem";
    fixture.append(spacer);

    try {
      const pageScrollRange =
        storyWindow.document.documentElement.scrollHeight - storyWindow.innerHeight;
      const mainScrollRange = main.scrollHeight - main.clientHeight;
      const viewportGaps: number[] = [];
      const sidebarTops: number[] = [];

      for (const scrollTop of [0, Math.round(mainScrollRange / 2), mainScrollRange]) {
        main.scrollTo({ top: scrollTop });
        await new Promise<void>((resolve) => {
          storyWindow.requestAnimationFrame(() => {
            resolve();
          });
        });
        viewportGaps.push(storyWindow.innerHeight - account.getBoundingClientRect().bottom);
        sidebarTops.push(sidebar.getBoundingClientRect().top);
      }

      await expect(pageScrollRange).toBeLessThanOrEqual(1);
      await expect(mainScrollRange).toBeGreaterThan(100);
      await waitFor(async () => {
        const distanceFromBottom =
          main.scrollHeight - main.clientHeight - main.scrollTop;

        await expect(Math.abs(distanceFromBottom)).toBeLessThanOrEqual(2);
      });
      await expect(Math.max(...viewportGaps) - Math.min(...viewportGaps)).toBeLessThan(4);
      await expect(Math.max(...sidebarTops) - Math.min(...sidebarTops)).toBeLessThan(1);
      await expect(
        Math.abs(sidebar.getBoundingClientRect().height - contents.getBoundingClientRect().height),
      ).toBeLessThan(1);
      await expect(within(account).getByText("К")).toBeInTheDocument();
      await expect(within(account).queryByRole("img")).not.toBeInTheDocument();
    } finally {
      spacer.remove();
      main.scrollTo({ top: 0 });
    }
  },
};

export const SidebarCompact: Story = {
  name: "Desktop auto-expand sidebar",
  args: {
    sidebarDefaultPinned: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sidebar = canvas.getByRole("complementary", { name: "Боковая панель" });
    const hoverRegion = sidebar.parentElement;
    const brand = canvas.getByRole("link", { name: "Sachkov Inside" });

    if (hoverRegion === null) {
      throw new Error("Sidebar hover region is missing");
    }

    await expect(brand).toHaveTextContent("S");
    await expect(
      canvas.queryByRole("button", { name: "Закрепить сайдбар" }),
    ).not.toBeInTheDocument();
    await userEvent.hover(hoverRegion);
    const toggle = canvas.getByRole("button", { name: "Закрепить сайдбар" });

    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.unhover(hoverRegion);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(toggle);
    await userEvent.unhover(hoverRegion);
    await waitFor(async () => {
      await expect(
        canvas.queryByRole("button", { name: "Закрепить сайдбар" }),
      ).not.toBeInTheDocument();
    });
  },
};

export const MobileSidebar: Story = {
  name: "Mobile bottom navigation",
  args: {
    sidebarDefaultPinned: false,
  },
  globals: {
    viewport: {
      isRotated: false,
      value: "mobile320",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const mobileNavigation = canvas.getByRole("navigation", {
      name: "Мобильная навигация",
    });

    await expect(within(mobileNavigation).getAllByRole("link")).toHaveLength(3);
    await expect(
      canvas.queryByRole("button", { name: "Открыть навигацию" }),
    ).not.toBeInTheDocument();
  },
};

function HomeShellFixture() {
  return (
    <div data-fixture="synthetic-navigation-proof">
      <header className="max-w-3xl">
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
          Главная
        </h1>
        <p className="mt-4 max-w-[66ch] text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          Рабочая точка входа в материалы, темы и активные серии Inside.
        </p>
      </header>

      <section className="mt-12 border-y border-border py-6" aria-labelledby="continue-heading">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.025em]" id="continue-heading">
              Продолжить
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">Последний открытый материал</p>
          </div>
          <a className="text-sm font-semibold underline decoration-accent decoration-2 underline-offset-4" href="#material">
            Надёжные фоновые задачи →
          </a>
        </div>
      </section>

      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.6fr)]">
        <section aria-labelledby="new-heading">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-[-0.03em]" id="new-heading">
              Новые материалы
            </h2>
            <a className="text-sm text-muted-foreground underline underline-offset-4" href="/library">
              Вся библиотека
            </a>
          </div>
          <div className="mt-5 divide-y divide-border border-y border-border">
            <MaterialRow
              format="Разбор"
              title="Как проектировать границы application layer"
              topic="Архитектура"
            />
            <MaterialRow
              format="Видео · 38 минут"
              title="Конкурентность без случайных retry"
              topic="Backend"
            />
            <MaterialRow
              format="Практика"
              title="Наблюдаемая доставка событий"
              topic="Инфраструктура"
            />
          </div>
        </section>

        <aside className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0" aria-labelledby="topics-heading">
          <h2 className="text-lg font-semibold tracking-[-0.02em]" id="topics-heading">
            Темы
          </h2>
          <ul className="mt-4 space-y-1" role="list">
            {["Архитектура", "Backend", "Инфраструктура", "Работа инженера"].map((topic) => (
              <li key={topic}>
                <a className="flex min-h-10 items-center justify-between rounded-lg px-2 text-sm no-underline hover:bg-muted" href="#topic">
                  {topic}
                  <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
                    →
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

interface MaterialRowProps {
  readonly format: string;
  readonly title: string;
  readonly topic: string;
}

function MaterialRow({ format, title, topic }: MaterialRowProps) {
  return (
    <a
      className="group grid gap-2 py-5 no-underline sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      href="#material"
    >
      <span>
        <span className="block text-base font-semibold tracking-[-0.015em] group-hover:underline group-hover:decoration-accent group-hover:underline-offset-4">
          {title}
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">{topic}</span>
      </span>
      <span className="font-mono text-xs text-muted-foreground">{format}</span>
    </a>
  );
}
