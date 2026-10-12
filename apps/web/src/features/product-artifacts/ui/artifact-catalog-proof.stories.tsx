import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { publicPageEnvironment } from "@/storybook/story-environment";

import {
  ArtifactCatalogProof,
  type ArtifactProofItem,
} from "./artifact-catalog.prototype.client";

// Synthetic resources for the proof; no Content or production data is changed.
const prompt = `Исследуй этот проект перед началом работы.

1. Прочитай AGENTS.md и README.md.
2. Найди точку входа и основные модули.
3. Объясни, как запрос проходит через приложение.
4. Укажи файлы, которые подтверждают каждый вывод.
5. Назови команды проверки из проекта.

Не меняй код до согласования плана.

Сначала покажи краткую карту проекта. Затем объясни границы модулей и предложи следующий шаг.
`;
const artifacts: readonly ArtifactProofItem[] = [
  {
    id: "project-map",
    title: "Разобраться в проекте",
    purpose:
      "Попросить агента построить карту проекта и объяснить связи между модулями.",
    category: "Промпт",
    updated: "12 октября 2026",
    resources: [
      {
        id: "prompt",
        name: "Промпт исследования",
        kind: "text",
        text: prompt,
        filename: "project-map.txt",
      },
    ],
  },
  {
    id: "review-skill",
    title: "Скилл для проверки изменений",
    purpose:
      "Добавить агенту инструкции и чек-лист. Два файла входят в один набор.",
    category: "Скилл",
    updated: "12 октября 2026",
    bundleHref:
      "data:application/zip;base64,UEsDBBQAAAAIAABgTF3C2qS+cgAAAIgAAAAIAAAAU0tJTEwubWQdzDEOgzAQRNHep1gpve+QIkmXgkTpLXvAGwxGuwuI24e4G72R/oU6LFXZqhwk2Bi7cx1Couvj9ny//JSoZ1Hz7s5zIssgnUIpUKOYwzzgtGCktWzQ9lvQ0bsPhPujgUDXYueUug650SL1i/hPII7q3Q9QSwMEFAAAAAgAAGBMXWUQ5NRQAAAAXQAAAAwAAABjaGVja2xpc3QubWRTVnBKTcsvSlVIzkjMS8/MS1dIzk9J5eLSVQhKTUxRKMlIVShJLM7WAwq4ZeZBBPLL80AKc/NTSnNSQTJBpXlgiaLUnNSyxLwSoGGpyUA9AFBLAQIUAxQAAAAIAABgTF3C2qS+cgAAAIgAAAAIAAAAAAAAAAAAAACAAQAAAABTS0lMTC5tZFBLAQIUAxQAAAAIAABgTF1lEOTUUAAAAF0AAAAMAAAAAAAAAAAAAACAAZgAAABjaGVja2xpc3QubWRQSwUGAAAAAAIAAgBwAAAAEgEAAAAA",
    resources: [
      {
        id: "skill",
        name: "SKILL.md",
        kind: "file",
        filename: "SKILL.md",
        text: "# Repository review\n\nRead AGENTS.md first.\nFind the smallest change that solves the task.\nVerify the result through the project checks.\n",
        prompt: `Сохрани файлы набора в отдельной папке skills.
Прочитай AGENTS.md проекта и проверь, где он хранит скиллы.
Не запускай команды до согласования плана.`,
      },
      {
        id: "checklist",
        name: "checklist.md",
        kind: "file",
        filename: "checklist.md",
        text: "# Before changing code\n\n- Read the task.\n- Find the owning module.\n- Run the relevant check.\n",
      },
    ],
  },
  {
    id: "mcp-tool",
    title: "Model Context Protocol",
    purpose:
      "Открыть официальный репозиторий и подготовить подключение инструмента к своему агенту.",
    category: "Инструмент",
    updated: "11 октября 2026",
    resources: [
      {
        id: "repository",
        name: "Официальный репозиторий",
        kind: "link",
        href: "https://github.com/modelcontextprotocol",
        prompt: `Посмотри документацию выбранного MCP-сервера.
Проверь требования и способ подключения для моего агента.
Покажи план настройки и необходимые разрешения.
Не запускай команды автоматически.`,
      },
    ],
  },
  {
    id: "diagram",
    title: "Файл без предпросмотра",
    purpose:
      "Пример сохранённого файла, который открывается в отдельном приложении.",
    category: "Файл",
    updated: "10 октября 2026",
    resources: [
      {
        id: "diagram",
        name: "Схема проекта",
        kind: "file",
        filename: "project.drawio",
        href: "data:application/xml;charset=utf-8,%3Cmxfile%3E%3Cdiagram%20name%3D%22Prototype%22%3E%3CmxGraphModel%3E%3Croot%3E%3CmxCell%20id%3D%220%22%2F%3E%3CmxCell%20id%3D%221%22%20parent%3D%220%22%2F%3E%3C%2Froot%3E%3C%2FmxGraphModel%3E%3C%2Fdiagram%3E%3C%2Fmxfile%3E",
      },
    ],
  },
  {
    id: "locked",
    title: "Ресурсы для первого выпуска",
    purpose:
      "Закрытый набор: каталог показывает назначение, но не его содержимое.",
    category: "Файл",
    updated: "9 октября 2026",
    locked: true,
    resources: [],
  },
];

const meta = {
  ...publicPageEnvironment("/library/series/inside-ai-engineering", {
    account: "guest",
  }),
  title: "Prototypes/Artifacts/Catalog and preview",
  component: ArtifactCatalogProof,
  args: { artifacts },
  parameters: {
    docs: {
      description: {
        component:
          "Прототип #1378: три структуры каталога и быстрый просмотр из урока. Данные синтетические; backend и ContentAccess не подключены.",
      },
    },
  },
} satisfies Meta<typeof ArtifactCatalogProof>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Catalog: Story = {};
export const OpenSections: Story = { args: { initialVariant: 1 } };
export const SplitView: Story = { args: { initialVariant: 2 } };
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const FromLesson: Story = { args: { context: "lesson" } };
export const FromLessonMobile: Story = {
  args: { context: "lesson" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Preview: Story = {
  args: { context: "lesson" },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: /Разобраться в проекте/u,
      }),
    );
  },
};
export const PreviewMobile: Story = {
  ...Preview,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Empty: Story = { args: { artifacts: [] } };
export const Loading: Story = { args: { status: "loading" } };
export const Unavailable: Story = { args: { status: "error" } };
