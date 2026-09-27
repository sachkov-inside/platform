import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { publicPageEnvironment } from "@/workshop/story-environment";
import type { LearningPracticesView } from "../model/learning-practice";
import { MaterialReaderView } from "./material-reader-view";
import { LearningPracticePrompts } from "./learning-practice-prompts";

const descriptor = {
  practiceId: "synthetic:brief",
  title: "Разобрать обращение бизнеса",
  contextVersion: "a".repeat(64),
  reviewProtocolVersion: "1",
};
function PracticeReader({
  result,
}: {
  readonly result: LearningPracticesView;
}) {
  return (
    <MaterialReaderView
      material={{
        materialId: "02000000-0000-4000-8000-000000000010",
        contentVersion: 1,
        slug: "consultations",
        title: "От обращения бизнеса к брифу",
        summary: "Самостоятельно сформулируй требования к консультациям.",
        access: "free",
        cover: null,
        format: { name: "Гайд", slug: "guide" },
        topic: { name: "AI Engineering", slug: "ai" },
        difficulty: null,
        outcomes: [],
        tags: [],
        seriesMemberships: [],
        publishedAt: "2026-09-27T00:00:00Z",
      }}
      body={[
        {
          kind: "paragraph",
          content: [
            {
              kind: "text",
              marks: [],
              text: "Участник отправляет заявку и видит её статус. Определи границы задачи и неизвестные условия, выбери формат брифа самостоятельно.",
            },
          ],
        },
      ]}
      primaryVideo={null}
      practiceActions={<LearningPracticePrompts result={result} />}
    />
  );
}
const environment = publicPageEnvironment("/materials/consultations", {
  account: "authenticated",
});
const meta = {
  ...environment,
  title: "Pages/Mobile-first Platform/Practice Review",
  component: PracticeReader,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Production Reader and its existing copy-prompt block. Synthetic descriptor; no claim of deployed MCP or native onboarding acceptance.",
      },
    },
  },
} satisfies Meta<typeof PracticeReader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {
  args: { result: { kind: "available", practices: [descriptor] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", { name: "Проверка практики" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(/обращение бизнеса · Codex/u),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(/обращение бизнеса · Claude Code/u),
    ).toBeInTheDocument();
    const buttons = canvas.getAllByRole("button", { name: "Копировать" });
    await expect(buttons).toHaveLength(2);
    const first = buttons[0];
    if (first === undefined) throw new Error("Expected copy action");
    await userEvent.click(first);
    await expect(
      await canvas.findByRole("button", { name: "Скопировано" }),
    ).toBeInTheDocument();
  },
};
export const Mobile: Story = {
  ...Ready,
  globals: { viewport: { value: "mobile320", isRotated: false } },
  play: async ({ canvasElement }) => {
    const page = canvasElement.ownerDocument.documentElement;
    await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth + 1);
    const buttons = within(canvasElement).getAllByRole("button", {
      name: "Копировать",
    });
    for (const button of buttons)
      await expect(
        button.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(44);
  },
};
export const Unavailable: Story = {
  args: { result: { kind: "unavailable" } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", { name: "Повторить" }),
    ).toBeInTheDocument();
    await expect(
      within(canvasElement).queryByText(/learning_practice_read/u),
    ).not.toBeInTheDocument();
  },
};
export const NoAssignment: Story = {
  args: { result: { kind: "available", practices: [] } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole("region", {
        name: "Проверка практики",
      }),
    ).not.toBeInTheDocument();
  },
};
