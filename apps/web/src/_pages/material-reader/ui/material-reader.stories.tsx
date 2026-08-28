import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import type {
  MaterialReaderMetadata,
  ReaderBlock,
} from "@/_pages/material-reader/model/material-reader-view";
import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import {
  MaterialReaderAccess,
  MaterialReaderLoading,
  MaterialReaderNotFound,
  MaterialReaderUnexpectedError,
  MaterialReaderUnavailable,
} from "./material-reader-states";
import { MaterialReaderView } from "./material-reader-view";

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "Библиотека" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

const material = {
  access: "free",
  format: { name: "Гайд", slug: "guide" },
  publishedAt: "2026-08-25T05:00:00.000Z",
  seriesMemberships: [
    {
      ordinal: 5,
      series: { name: "Создание Platform Inside", slug: "platform-inside" },
    },
  ],
  slug: "agent-first-skills",
  summary:
    "Как превратить повторяемый инженерный процесс в короткую repository-owned инструкцию, которую человек и агент выполняют одинаково.",
  tags: [{ name: "agent skills" }, { name: "harness" }],
  title: "Публичные skills для agent-first setup",
  topic: { name: "AI-first engineering", slug: "ai-first-engineering" },
} as const satisfies MaterialReaderMetadata;

const body = [
  {
    kind: "paragraph",
    content: [
      {
        kind: "text",
        text: "Хороший skill начинается с повторяемого решения и проверяемого результата.",
        marks: [{ kind: "bold" }],
      },
    ],
  },
  {
    kind: "heading",
    level: 2,
    content: [{ kind: "text", text: "Сначала найдите устойчивый seam", marks: [] }],
  },
  {
    kind: "paragraph",
    content: [
      {
        kind: "text",
        text: "Запишите вход, observable result и границу ответственности.",
        marks: [],
      },
    ],
  },
  {
    kind: "bullet_list",
    items: [
      [
        {
          kind: "paragraph",
          content: [{ kind: "text", text: "Один authority", marks: [] }],
        },
      ],
      [
        {
          kind: "paragraph",
          content: [{ kind: "text", text: "Один workflow", marks: [] }],
        },
      ],
      [
        {
          kind: "paragraph",
          content: [{ kind: "text", text: "Одна проверка", marks: [] }],
        },
      ],
    ],
  },
  {
    kind: "callout",
    tone: "warning",
    content: [
      {
        kind: "paragraph",
        content: [
          {
            kind: "text",
            text: "Skill дополняет project rules, но не отменяет их.",
            marks: [],
          },
        ],
      },
    ],
  },
  {
    kind: "code_block",
    text: "export const isReady = (evidence: readonly string[]) => evidence.length > 0",
  },
  {
    kind: "heading",
    level: 2,
    content: [{ kind: "text", text: "Проверьте instruction на двух задачах", marks: [] }],
  },
  {
    kind: "table",
    rows: [
      {
        cells: [
          {
            header: true,
            content: [
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Признак", marks: [] }],
              },
            ],
          },
          {
            header: true,
            content: [
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Evidence", marks: [] }],
              },
            ],
          },
        ],
      },
      {
        cells: [
          {
            header: false,
            content: [
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Trigger", marks: [] }],
              },
            ],
          },
          {
            header: false,
            content: [
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Две реальные задачи", marks: [] }],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: "image",
    assetId: "image-agent-path",
    alt: "Маршрут от project rules через skill к evidence",
    caption: "Один authority, один workflow, одна проверка",
  },
  {
    kind: "file",
    assetId: "skill-review-checklist",
    label: "Чек-лист проверки repository-owned skill",
  },
  {
    kind: "video",
    videoId: "skill-review-session",
    caption: "Разбор проверки skill contract",
  },
] as const satisfies readonly ReaderBlock[];

type ReaderStoryMode =
  | "access-required"
  | "access-unavailable"
  | "desktop"
  | "error"
  | "loading"
  | "mobile"
  | "not-found"
  | "unavailable";

function MaterialReaderBoard({ mode }: { readonly mode: ReaderStoryMode }) {
  return (
    <ApplicationShell
      accountLabel="Кирилл"
      currentPath={`/materials/${material.slug}`}
      navigationItems={navigationItems}
      sidebarDefaultPinned
    >
      <MaterialReaderState mode={mode} />
    </ApplicationShell>
  );
}

function MaterialReaderState({ mode }: { readonly mode: ReaderStoryMode }) {
  switch (mode) {
    case "desktop":
    case "mobile":
      return <MaterialReaderView body={body} material={material} />;
    case "loading":
      return <MaterialReaderLoading />;
    case "not-found":
      return <MaterialReaderNotFound />;
    case "access-required":
      return (
        <MaterialReaderAccess
          cta={{
            label: "Получить доступ",
            url: "https://t.me/tribute/app?startapp=inside",
          }}
          material={{ ...material, access: "membership" }}
        />
      );
    case "access-unavailable":
      return <MaterialReaderUnavailable slug={material.slug} />;
    case "error":
      return <MaterialReaderUnexpectedError onRetry={() => undefined} />;
    case "unavailable":
      return <MaterialReaderUnavailable slug={material.slug} />;
  }
}

const meta = {
  component: MaterialReaderBoard,
  parameters: {
    docs: {
      description: {
        component:
          "Production-owned Reader presentation. Stories exercise the exact UI used by the App Router route while fixtures stay outside the production graph.",
      },
    },
    nextjs: { appDirectory: true },
  },
  title: "Pages/Material/Reader",
} satisfies Meta<typeof MaterialReaderBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mobile: Story = {
  args: { mode: "mobile" },
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Публичные skills для agent-first setup", level: 1 }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("navigation", { name: "Мобильная навигация" })).toBeInTheDocument();
    await expect(canvas.getByText("В этом материале", { selector: "summary" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Ресурсы" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("article")).toHaveLength(1);
  },
};

export const Desktop: Story = {
  args: { mode: "desktop" },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("navigation", { name: "В этом материале" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("link", { name: "В Библиотеку" })).toHaveLength(2);
    await expect(canvas.getByRole("region", { name: "Таблица в материале" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Ресурсы" })).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { mode: "loading" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText("Материал загружается")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  },
};

export const NotFound: Story = {
  args: { mode: "not-found" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Материал не найден" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "В Библиотеку" })).toBeInTheDocument();
  },
};

export const AccessRequired: Story = {
  args: { mode: "access-required" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал доступен в Мастерской" }),
    ).toBeInTheDocument();
    const membershipLink = canvas.getByRole("link", { name: "Получить доступ" });
    await expect(membershipLink).toHaveAttribute(
      "href",
      "https://t.me/tribute/app?startapp=inside",
    );
    await expect(membershipLink).toHaveAttribute("target", "_blank");
    await expect(membershipLink).toHaveAttribute("rel", "noopener noreferrer");
    await expect(canvas.queryByText("Хороший skill начинается")).not.toBeInTheDocument();
  },
};

export const AccessUnavailable: Story = {
  args: { mode: "access-unavailable" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал временно недоступен" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Повторить" })).toBeInTheDocument();
  },
};

export const Unavailable: Story = {
  args: { mode: "unavailable" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал временно недоступен" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Повторить" })).toBeInTheDocument();
  },
};

export const UnexpectedError: Story = {
  args: { mode: "error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал сейчас недоступен" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
  },
};
