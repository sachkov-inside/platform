import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use } from "react";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { SavedReadingAction } from "@/features/reading-progress";
import { publicPageEnvironment } from "@/storybook/story-environment";
import {
  boxOf,
  settleStoryFrame,
  stagedLoaders,
  stagedLoadingOf,
} from "@/storybook/loads-in-place";
import type { LearningPracticesView } from "../model/learning-practice";
import { MaterialReaderView } from "./material-reader-view";
import {
  LearningPracticeDisclosure,
  LearningPracticePrompts,
} from "./learning-practice-prompts";

const connection = {
  url: "https://inside.example.test/mcp/learning",
  publicClientId: "o92nmcpzb2te8z4loi82d",
  setupUrl: "https://inside.example.test/practice-review-setup.txt",
};
const descriptor = {
  practiceId: "synthetic:brief",
  title: "Разобрать обращение бизнеса",
  contextVersion: "a".repeat(64),
  reviewProtocolVersion: "2",
};
function PracticeReader({
  result,
  disclosure = false,
  ready,
}: {
  readonly result: LearningPracticesView;
  readonly disclosure?: boolean;
  readonly ready?: Promise<void>;
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
      readingAction={
        <SavedReadingAction
          compact
          format="guide"
          materialId="02000000-0000-4000-8000-000000000010"
        />
      }
      bookmarkAction={
        <SavedBookmarkAction
          compact
          materialId="02000000-0000-4000-8000-000000000010"
        />
      }
      practiceActions={
        disclosure ? undefined : (
          <LearningPracticePrompts connection={connection} result={result} />
        )
      }
      deferredPracticeActions={
        disclosure ? (
          <Suspense fallback={<LearningPracticeDisclosure result={null} />}>
            {ready === undefined ? (
              <LearningPracticeDisclosure
                connection={connection}
                result={result}
              />
            ) : (
              <DeferredPractice ready={ready} result={result} />
            )}
          </Suspense>
        ) : undefined
      }
    />
  );
}
function DeferredPractice({
  ready,
  result,
}: {
  readonly ready: Promise<void>;
  readonly result: LearningPracticesView;
}) {
  use(ready);
  return <LearningPracticeDisclosure connection={connection} result={result} />;
}
const environment = publicPageEnvironment("/materials/consultations", {
  account: "authenticated",
});
const meta = {
  ...environment,
  title: "Pages/Material Reader/Practice Review",
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
  beforeEach: () => {
    const clipboard = spyOn(
      navigator.clipboard,
      "writeText",
    ).mockResolvedValue();
    return () => {
      clipboard.mockRestore();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", { name: "Проверка практики" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("Разобрать обращение бизнеса"),
    ).toBeInTheDocument();
    // Запрос подключения агента в «Настройке проверки» и один запрос на задание для любого агента.
    await expect(canvas.queryByText(/Codex$/u)).not.toBeInTheDocument();
    await expect(canvas.getByText(connection.url)).toBeInTheDocument();
    await expect(canvas.getByText("Подключить агента")).toBeInTheDocument();
    const buttons = canvas.getAllByRole("button", { name: "Копировать" });
    await expect(buttons).toHaveLength(2);
    const practice = buttons.at(-1);
    if (practice === undefined) throw new Error("Expected copy action");
    await userEvent.click(practice);
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

export const PublicLesson: Story = {
  args: {
    result: { kind: "available", practices: [descriptor] },
    disclosure: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const slot = canvasElement.querySelector("[data-practice-summary]");
    await expect(slot?.getBoundingClientRect().height).toBe(44);
    await expect(
      canvas.queryByRole("region", { name: "Проверка практики" }),
    ).not.toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Открыть проверку практики",
        exact: true,
      }),
    );
    await expect(
      canvas.getByRole("region", { name: "Проверка практики" }),
    ).toBeVisible();
  },
};

export const EmptyDisclosure: Story = {
  args: { result: { kind: "available", practices: [] }, disclosure: true },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector("[data-practice-summary]"),
    ).toBeNull();
    const body = canvasElement.querySelector("[data-reader-body]");
    const actions = canvasElement.querySelector("[data-material-actions]");
    if (body === null || actions === null) throw new Error("Reader is missing");
    await expect(
      actions.getBoundingClientRect().top - body.getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(24);
  },
};

/** Short standalone public Reader includes the real site footer, not only its own buttons. */
function delayedPractice(
  result: LearningPracticesView,
  width: 1440 | 390 | 320,
  enlarged = false,
): Story {
  const viewport =
    width === 1440 ? "desktop1440" : width === 390 ? "mobile390" : "mobile320";
  return {
    args: { result, disclosure: true },
    loaders: stagedLoaders,
    globals: { viewport: { value: viewport, isRotated: false } },
    render: (args, { loaded }) => (
      <PracticeReader {...args} ready={stagedLoadingOf(loaded).personalPart} />
    ),
    beforeEach: () => {
      if (!enlarged) return;
      const root = document.documentElement;
      const previous = root.style.fontSize;
      root.style.fontSize = "200%";
      return () => {
        root.style.fontSize = previous;
      };
    },
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const canvas = within(canvasElement);
      const sequence = stagedLoadingOf(loaded);
      const anchors = [
        "[data-material-actions]",
        "footer:has(nav[aria-label='Документы Inside'])",
      ];
      await expect(
        canvasElement.querySelector("[data-practice-loading]"),
      ).toBeVisible();
      await expect(
        canvas.getByRole("navigation", { name: "Документы Inside" }),
      ).toBeVisible();
      const before = anchors.map((selector) => boxOf(canvasElement, selector));
      sequence.deliverPersonalPart();
      await waitFor(() =>
        expect(
          canvasElement.querySelector("[data-practice-loading]"),
        ).toBeNull(),
      );
      const after = anchors.map((selector) => boxOf(canvasElement, selector));
      await expect(after).toEqual(before);
      await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
      if (result.kind === "available" && result.practices.length === 0) {
        await expect(
          canvas.queryByRole("button", { name: "Открыть проверку практики" }),
        ).toBeNull();
      } else {
        await userEvent.click(
          canvas.getByRole("button", { name: "Открыть проверку практики" }),
        );
        await expect(
          result.kind === "available"
            ? canvas.getByRole("region", { name: "Проверка практики" })
            : canvas.getByText("Задания для проверки сейчас недоступны."),
        ).toBeVisible();
      }
    },
  };
}
const empty = { kind: "available", practices: [] } as const;
const present = { kind: "available", practices: [descriptor] } as const;
const unavailable = { kind: "unavailable" } as const;
export const DelayedEmpty: Story = delayedPractice(empty, 1440);
export const DelayedPresent: Story = delayedPractice(present, 1440);
export const DelayedUnavailable: Story = delayedPractice(unavailable, 1440);
export const DelayedEmptyMobile: Story = delayedPractice(empty, 390);
export const DelayedPresentMobile: Story = delayedPractice(present, 390);
export const DelayedUnavailableMobile: Story = delayedPractice(
  unavailable,
  390,
);
export const DelayedEmpty320: Story = delayedPractice(empty, 320);
export const DelayedPresent320: Story = delayedPractice(present, 320);
export const DelayedUnavailable320: Story = delayedPractice(unavailable, 320);
export const DelayedEmptyEnlarged: Story = delayedPractice(empty, 320, true);
export const DelayedPresentEnlarged: Story = delayedPractice(
  present,
  320,
  true,
);
export const DelayedUnavailableEnlarged: Story = delayedPractice(
  unavailable,
  320,
  true,
);
