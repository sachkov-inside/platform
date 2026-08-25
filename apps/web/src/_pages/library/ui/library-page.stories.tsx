import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  LibraryLoading,
  LibraryPage,
  LibraryUnexpectedError,
} from "@/_pages/library/ui/library-page";
import type { MaterialPreview } from "@/entities/material";
import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "Библиотека" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

const catalogItems = [
  {
    access: "membership",
    format: "Видео",
    preview: {
      duration: "38:42",
      label: "Пять стадий delivery от ready issue до owner-approved merge",
      steps: ["Issue", "Ветка", "Checks", "PR", "GO"],
    },
    seriesMemberships: [{ name: "Создание Platform Inside", ordinal: 5 }],
    slug: "platform-delivery",
    summary:
      "Как связать issue, task branch, evidence, pull request и явный owner GO.",
    tags: ["developer pipeline", "harness"],
    title: "Developer Pipeline и owner-controlled delivery",
    topic: "Product engineering",
  },
  {
    access: "free",
    format: "Гайд",
    seriesMemberships: [],
    slug: "public-agent-skills",
    summary:
      "Как превратить повторяемый инженерный процесс в короткую repository-owned инструкцию.",
    tags: ["agent skills", "workflow"],
    title: "Публичные skills для agent-first setup",
    topic: "AI-first engineering",
  },
  {
    access: "membership",
    format: "Гайд",
    seriesMemberships: [],
    slug: "resume-hypotheses",
    summary:
      "Практический разбор воронки поиска, структуры резюме и проверки гипотез.",
    tags: ["job search", "resume"],
    title: "Поиск работы и резюме в IT",
    topic: "Карьера",
  },
] as const satisfies readonly MaterialPreview[];

function ProductionShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <ApplicationShell
      accountLabel="Гость"
      currentPath="/library"
      navigationItems={navigationItems}
      sidebarDefaultPinned
    >
      {children}
    </ApplicationShell>
  );
}

const meta = {
  component: LibraryPage,
  decorators: [
    (Story) => (
      <ProductionShell>
        <Story />
      </ProductionShell>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "Production-owned Library presentation used by the RSC route and Storybook fixtures. Search and taxonomy navigation remain outside #90.",
      },
    },
    nextjs: { appDirectory: true },
  },
  title: "Pages/Library/Production",
} satisfies Meta<typeof LibraryPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ReadyDesktop: Story = {
  args: { result: { kind: "ready", firstHref: null, items: catalogItems, nextHref: null } },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Ready · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cards = Array.from(canvasElement.querySelectorAll<HTMLElement>("article"));
    const grid = canvasElement.querySelector<HTMLElement>("[data-material-grid]");

    await expect(cards).toHaveLength(3);
    await expect(canvas.getByText("Бесплатно")).toBeInTheDocument();
    await expect(canvas.getAllByText("Для участников")).toHaveLength(2);
    await expect(
      canvas.getByRole("link", { name: catalogItems[1].title }),
    ).toHaveAttribute("href", "/materials/public-agent-skills");
    if (grid === null) {
      throw new Error("Material grid is missing");
    }
    await expect(getComputedStyle(grid).gridTemplateColumns.split(" ")).toHaveLength(2);
  },
};

export const ReadyMobile: Story = {
  args: { result: { kind: "ready", firstHref: null, items: catalogItems, nextHref: null } },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Ready · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const grid = canvasElement.querySelector<HTMLElement>("[data-material-grid]");

    await expect(canvas.getByRole("heading", { name: "Библиотека" })).toBeInTheDocument();
    if (grid === null) {
      throw new Error("Material grid is missing");
    }
    await expect(getComputedStyle(grid).gridTemplateColumns.split(" ")).toHaveLength(1);
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
    const firstCardLink = canvas.getByRole("link", {
      name: `Открыть материал: ${catalogItems[0].title}`,
    });
    for (
      let tabIndex = 0;
      tabIndex < 12 && canvasElement.ownerDocument.activeElement !== firstCardLink;
      tabIndex += 1
    ) {
      await userEvent.tab();
    }
    await expect(firstCardLink).toHaveFocus();
  },
};

export const Pagination: Story = {
  args: {
    result: {
      kind: "ready",
      firstHref: "/library",
      items: catalogItems,
      nextHref: "/library?after=representative-cursor",
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("link", { name: "Следующая страница" }),
    ).toHaveAttribute("href", "/library?after=representative-cursor");
    await expect(
      within(canvasElement).getByRole("link", { name: "К началу" }),
    ).toHaveAttribute("href", "/library");
  },
};

export const Loading: Story = {
  args: { result: { kind: "empty", firstHref: null } },
  render: () => <LibraryLoading />,
};

export const Empty: Story = {
  args: { result: { kind: "empty", firstHref: null } },
};

export const Unavailable: Story = {
  args: { result: { kind: "unavailable" } },
  name: "Controlled error",
};

export const UnexpectedError: Story = {
  args: { result: { kind: "empty", firstHref: null } },
  name: "Unexpected error",
  render: () => <LibraryUnexpectedError onRetry={() => undefined} />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("heading", { level: 1, name: "Библиотека" }),
    ).toBeInTheDocument();
  },
};
