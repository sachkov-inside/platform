import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { publicPageEnvironment } from "@/storybook/story-environment";

import {
  ArtifactCatalogProof,
  type ArtifactProofItem,
} from "./artifact-catalog.prototype.client";

// Synthetic resources for the proof; no Content or production data is changed.
const prompt = `Review this repository before implementing a change. Produce an evidence-based project map that another engineer can use to find the correct module and its checks. This is a synthetic example for the artifact preview, not an assignment to change this repository.

## 1. Establish the task boundary

Read the root AGENTS.md and README.md. Follow the instructions nearest to each surface you inspect. Identify the application's purpose, its users, and the concrete result requested by the issue. Keep product requirements separate from implementation choices. When an owner decision is missing, describe the choice and the evidence needed to resolve it.

Completion: name the owning application, the relevant instructions, the issue, and the observable result. Cite repository paths rather than assuming the directory name describes ownership.

## 2. Find the application's entry points

Inspect the project manifest and the application's startup code. Find where HTTP requests, background jobs, scheduled work, and command-line tasks enter the system. Follow one representative operation through its actual call path. Distinguish generated code from authored code and name the source that owns a generated contract.

Completion: show one short call sequence from the entry point to the operation's result. Each step must name an actual source file and explain the responsibility at that point.

## 3. Map the domain boundaries

Read the project glossary and the architecture decisions relevant to the task. Locate the module that owns each fact the feature reads or writes. Describe the module's public interface and the rules it keeps behind that interface. Check whether the caller obtains a domain result, a transport response, or a presentation model.

Completion: list the owning modules, their public entry points, and the dependencies that the proposed change needs. Explain an unfamiliar term once and keep the same term throughout the report.

## 4. Follow data and access decisions

Find how the operation validates an external value before using it. Trace identity, authorization, persistence, and delivery separately. When an operation exposes protected content, identify the common policy that authorizes the result and the cache boundary that could retain it. Describe failure behavior using the actual result types and handlers.

Completion: explain where the operation accepts input, checks access, commits data, and exposes the result. Cite the source for each claim. Mark an unanswered question explicitly instead of inferring a guarantee from a type name.

## 5. Identify the verification seams

Find the tests that observe the public operation. Read the test setup and the assertions rather than relying on a test title. Select the smallest existing check that can reveal a broken requirement. Explain which fact the check observes and which parts remain outside that check. Read the project's own commands when deciding how to run verification.

Completion: name the command, the tested boundary, the observable result, and the remaining limitation. Prefer a committed fact over a wait by duration. Keep fixtures isolated between cases and use fixed dates when the scenario depends on time.

## 6. Propose the smallest implementation

Use the existing module interface when it already owns the required behavior. Name the specific reason before proposing an additional abstraction, dependency, or transport path. Preserve stable identities, content ownership, access rules, and callers that the task did not request changing. Distinguish a required repair from an unrelated improvement.

Completion: give a short list of changes, the reason for each change, and the check that verifies its effect. State any migration or compatibility constraint that changes the implementation order.

## 7. Prepare the report

Start with the result the owner needs to understand. Include the project map, the evidence for important claims, the proposed change, and the checks. Distinguish inspected behavior from a hypothesis. If a fact remains unknown, describe the next inspection that can resolve it. Keep recommendations proportional to the measured problem.

Completion: another engineer can find the owning module, reproduce the inspection, and verify the proposed result using the report. End with one concrete next step and any decision that must come from the owner.

END OF PROJECT REVIEW PROMPT.
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
        prompt: `Read the project AGENTS.md and locate its skill directory.
Show where the two files will go.
Wait for approval before running installation commands.`,
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
        prompt: `Read the selected MCP server documentation.
Verify the requirements and connection method for my agent.
Show the setup plan and required permissions.
Wait for approval before running setup commands.`,
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
