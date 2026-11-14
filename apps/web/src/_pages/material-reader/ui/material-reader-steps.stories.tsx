import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { z } from "zod";

import type { RenderedBlock } from "@inside/material-blocks";
import {
  guestOpenedPartsKey,
  lessonOpenedPartsChanges,
  ReadingProgressProvider,
} from "@/features/reading-progress";
import { getQueryClient } from "@/shared/api/query-client";
import { accountPresentationResponse } from "@/storybook/account.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { MaterialReaderView } from "./material-reader-view";

const materialId = "02000000-0000-4000-8000-000000002122";
const accountId = "20000000-0000-4000-8000-000000002122";

const text = (value: string, href?: string) => ({
  kind: "text" as const,
  text: value,
  marks: href === undefined ? [] : [{ kind: "link" as const, href }],
});
const paragraph = (...content: ReturnType<typeof text>[]): RenderedBlock => ({
  kind: "paragraph",
  content,
});
const heading = (value: string): RenderedBlock => ({
  kind: "heading",
  level: 2,
  content: [text(value)],
});

/**
 * Four parts: a step break, an «after answer» exercise and a «Готово!» break end the first three.
 * The first part links to the last part's heading.
 */
const body: RenderedBlock[] = [
  heading("Задача"),
  paragraph(
    text("Агент пишет код по описанию результата. Итог в "),
    text("последнем разделе", "#итог"),
    text("."),
  ),
  { kind: "step_break", label: "А как проверить результат?" },
  heading("Проверка"),
  paragraph(text("Проверка начинается с наблюдаемого поведения.")),
  {
    kind: "quiz",
    id: "observable-result",
    reveal: "after-answer",
    question: [paragraph(text("Что лучше проверяет результат?"))],
    selectionMode: "single",
    options: [
      {
        id: "visible",
        content: [paragraph(text("Пользователь видит созданную запись."))],
        correct: true,
      },
      {
        id: "stack",
        content: [paragraph(text("Код написан на TypeScript."))],
        correct: false,
        explanation: [paragraph(text("Неверно. Это выбор инструмента."))],
      },
    ],
  },
  paragraph(text("Разбор: проверяйте то, что видит пользователь.")),
  { kind: "step_break", label: "Готово!" },
  heading("Итог"),
  paragraph(text("Результат описан, проверка понятна.")),
];

let saved: number[] = [];
let serverParts: number | null = null;
let failedStateReads = 0;

const environment = publicPageEnvironment("/materials/step-reveal");
const meta = {
  ...environment,
  id: "pages-material-reader-steps",
  title: "Pages/Material Reader/Step Reveal",
  component: MaterialReaderView,
  beforeEach: ({ parameters }) => {
    getQueryClient().clear();
    environment.beforeEach();
    saved = [];
    failedStateReads = z.number().parse(parameters["failedStateReads"] ?? 0);
    serverParts = z
      .number()
      .nullable()
      .parse(parameters["serverParts"] ?? null);
    window.localStorage.removeItem(guestOpenedPartsKey(materialId));
    const guestParts: unknown = parameters["guestParts"];
    if (typeof guestParts === "number")
      window.localStorage.setItem(
        guestOpenedPartsKey(materialId),
        String(guestParts),
      );
    return fetchBeforeRender(async (input, init) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      ).pathname;
      if (path === "/api/account") return accountPresentationResponse();
      if (path === "/api/reading-progress/states" && failedStateReads > 0) {
        failedStateReads -= 1;
        return Response.json({ kind: "unavailable" }, { status: 503 });
      }
      if (path === "/api/reading-progress/states")
        return Response.json({
          kind: "ready",
          states: [
            {
              materialId,
              isRead: false,
              version: 0,
              readAt: null,
              updatedAt: null,
              updateNote: null,
              openedParts: serverParts,
            },
          ],
        });
      if (path === "/api/reading-progress/opened-parts") {
        const raw = input instanceof Request ? await input.text() : init?.body;
        const { openedParts } = z
          .object({ openedParts: z.number() })
          .parse(JSON.parse(typeof raw === "string" ? raw : "{}"));
        saved.push(openedParts);
        return Response.json({ kind: "saved", openedParts });
      }
      return Response.json({ kind: "unavailable" }, { status: 503 });
    })();
  },
  decorators: [
    (Story, context) => (
      <ReadingProgressProvider
        accountId={context.parameters["signedIn"] === true ? accountId : null}
        resolved
      >
        <Story />
      </ReadingProgressProvider>
    ),
    ...environment.decorators,
  ],
  args: {
    body,
    primaryVideo: null,
    termDeck: <section aria-label="Термины урока">Термины урока</section>,
    exerciseSummary: (
      <section aria-label="Упражнения урока">Упражнения: 1 из 1 решены</section>
    ),
    lessonRating: <section aria-label="Как вам урок?">Как вам урок?</section>,
    material: {
      materialId,
      contentVersion: 1,
      access: "free",
      cover: null,
      format: { name: "Гайд", slug: "guide" },
      difficulty: "basic",
      outcomes: [],
      publishedAt: "2026-11-13T09:00:00.000Z",
      productMemberships: [],
      slug: "step-reveal",
      summary: "Учебная фикстура пошагового урока.",
      tags: [],
      title: "Результат и его проверка",
      topic: { name: "AI-first engineering", slug: "ai-first-engineering" },
    },
  },
} satisfies Meta<typeof MaterialReaderView>;
export default meta;
type Story = StoryObj<typeof meta>;

const visible = (canvasElement: HTMLElement, value: string) =>
  within(canvasElement).queryByText(value);
const guestParts = () =>
  window.localStorage.getItem(guestOpenedPartsKey(materialId));

/** A guest opens the next part by its button; the button becomes the reader's own reply. */
export const GuestOpensNextPart: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Агент пишет код по описанию результата/u),
    ).toBeVisible();
    await expect(
      canvas.getByText("Проверка начинается с наблюдаемого поведения."),
    ).not.toBeVisible();
    await expect(
      canvas.queryByRole("region", { name: "Термины урока" }),
    ).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "А как проверить результат?" }),
    );
    await expect(
      canvas.getByText("Проверка начинается с наблюдаемого поведения."),
    ).toBeVisible();
    const reply = canvasElement.querySelector<HTMLElement>(
      "[data-lesson-reply]",
    );
    if (reply === null) throw new Error("The reply is missing");
    await expect(within(reply).getByText("Вы")).toBeVisible();
    await expect(
      within(reply).getByText("А как проверить результат?"),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "А как проверить результат?" }),
    ).toBeNull();
    await expect(guestParts()).toBe("2");
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
  },
};
export const GuestOpensNextPartMobile: Story = {
  ...GuestOpensNextPart,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** An «after answer» exercise keeps the text below closed until any first answer. */
export const AnswerOpensText: Story = {
  parameters: { guestParts: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const explanation = "Разбор: проверяйте то, что видит пользователь.";
    await waitFor(() =>
      expect(
        canvas.getByText("Проверка начинается с наблюдаемого поведения."),
      ).toBeVisible(),
    );
    await expect(canvas.getByText(explanation)).not.toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Пропустить" }),
    ).toBeVisible();
    // A wrong answer opens the text as well: the exercise checks understanding, it is no gate.
    await userEvent.click(canvas.getByRole("button", { name: /Код написан/u }));
    await expect(canvas.getByText(explanation)).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Пропустить" }),
    ).toBeNull();
    await expect(guestParts()).toBe("3");
    await userEvent.click(
      canvas.getByRole("button", { name: "Ответить ещё раз" }),
    );
    await expect(canvas.getByText(explanation)).toBeVisible();
  },
};

const afterMatch = "Разбор: индексация идёт до вопроса.";
const afterOrder = "Разбор: поиск идёт по готовому индексу.";
const option = (value: string) => [paragraph(text(value))];
/** «Сопоставь» and «Расставь по порядку» that hide the text below until an answer (#2123). */
const matchAndOrderBody: RenderedBlock[] = [
  heading("Этапы"),
  paragraph(text("RAG сначала готовит индекс, потом отвечает на вопросы.")),
  {
    kind: "match",
    id: "rag-stages",
    reveal: "after-answer",
    question: option("Когда выполняется действие?"),
    mode: "groups",
    rows: [
      ["split", "Нарезать документы", "offline"],
      ["embed", "Посчитать эмбеддинги документов", "offline"],
      ["search", "Найти похожие чанки", "online"],
    ].map(([id = "", value = "", answerId = ""]) => ({
      id,
      content: option(value),
      answerId,
      explanation: option(`Пояснение: ${value}.`),
    })),
    choices: [
      { id: "offline", content: option("Заранее") },
      { id: "online", content: option("На каждый запрос") },
    ],
  },
  paragraph(text(afterMatch)),
  {
    kind: "order",
    id: "rag-pipeline",
    reveal: "after-answer",
    question: option("Расставь шаги по порядку."),
    steps: [
      ["chunk", "Нарезать"],
      ["index", "Проиндексировать"],
      ["find", "Найти"],
    ].map(([id = "", value = ""]) => ({
      id,
      content: option(value),
      explanation: option(`Шаг «${value}».`),
    })),
  },
  paragraph(text(afterOrder)),
];

/** A wrong answer opens the text; «Начать заново» and «Ответить ещё раз» never close it again. */
export const MatchAndOrderOpenText: Story = {
  args: { body: matchAndOrderBody },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText(afterMatch)).not.toBeVisible());
    const match = within(
      canvas.getByRole("region", { name: "Упражнение 1 из 2" }),
    );
    for (const select of match.getAllByRole("combobox"))
      await userEvent.selectOptions(select, "На каждый запрос");
    await userEvent.click(match.getByRole("button", { name: "Проверить" }));
    await expect(canvas.getByText(afterMatch)).toBeVisible();
    await userEvent.click(match.getByRole("button", { name: "Начать заново" }));
    await expect(canvas.getByText(afterMatch)).toBeVisible();

    const order = within(
      canvas.getByRole("region", { name: "Упражнение 2 из 2" }),
    );
    await expect(canvas.getByText(afterOrder)).not.toBeVisible();
    await userEvent.click(order.getByRole("button", { name: "Проверить" }));
    await expect(canvas.getByText(afterOrder)).toBeVisible();
    await userEvent.click(
      order.getByRole("button", { name: "Ответить ещё раз" }),
    );
    await expect(canvas.getByText(afterOrder)).toBeVisible();
    await expect(canvas.getByText(afterMatch)).toBeVisible();
  },
};

/** «Пропустить» opens the text without an answer. */
export const SkipOpensText: Story = {
  parameters: { guestParts: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const skip = await canvas.findByRole("button", { name: "Пропустить" });
    await userEvent.click(skip);
    await expect(
      canvas.getByText("Разбор: проверяйте то, что видит пользователь."),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Готово!" })).toBeVisible();
  },
};

/** The last part opens the term deck that follows the lesson. */
export const LastPartOpensTermDeck: Story = {
  parameters: { guestParts: 3 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Готово!" }),
    );
    await expect(
      canvas.getByText("Результат описан, проверка понятна."),
    ).toBeVisible();
    await expect(
      canvas.getByRole("region", { name: "Термины урока" }),
    ).toBeVisible();
  },
};

/**
 * The end of the lesson waits for its last part and reads in one order: the term deck, the
 * exercises summary, then the rating.
 */
export const LessonEndWaitsForLastPart: Story = {
  parameters: { guestParts: 3 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const end = ["Термины урока", "Упражнения урока", "Как вам урок?"];
    for (const name of end)
      await expect(
        canvas.getByRole("region", { name, hidden: true }),
      ).not.toBeVisible();
    await userEvent.click(
      await canvas.findByRole("button", { name: "Готово!" }),
    );
    const regions = end.map((name) => canvas.getByRole("region", { name }));
    for (const region of regions) await expect(region).toBeVisible();
    const tops = regions.map((region) => region.getBoundingClientRect().top);
    await expect([...tops].sort((left, right) => left - right)).toEqual(tops);
  },
};

/** «Показать урок целиком» shows every part and leaves the opened parts as they were. */
export const WholeLesson: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const whole = canvas.getByRole("switch", { name: "Показать урок целиком" });
    await userEvent.click(whole);
    for (const value of [
      "Проверка начинается с наблюдаемого поведения.",
      "Разбор: проверяйте то, что видит пользователь.",
      "Результат описан, проверка понятна.",
    ])
      await expect(canvas.getByText(value)).toBeVisible();
    await expect(
      canvas.getByRole("region", { name: "Термины урока" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "А как проверить результат?" }),
    ).toBeNull();
    await expect(guestParts()).toBeNull();
    await userEvent.click(whole);
    await expect(
      canvas.getByText("Проверка начинается с наблюдаемого поведения."),
    ).not.toBeVisible();
  },
};

/** A link to a heading in a closed part opens every part up to it. */
export const AnchorOpensParts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: "последнем разделе" });
    // Vitest supplies a base URL; keep fragment navigation inside its tester iframe.
    link.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        window.location.hash = link.getAttribute("href") ?? "";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      },
      { once: true },
    );
    const previousUrl = window.location.href;
    try {
      await userEvent.click(link);
      await expect(canvas.getByRole("heading", { name: "Итог" })).toBeVisible();
      await expect(
        canvas.getByText("Разбор: проверяйте то, что видит пользователь."),
      ).toBeVisible();
      await expect(guestParts()).toBe("4");
    } finally {
      window.history.replaceState(window.history.state, "", previousUrl);
    }
  },
};

/** A guest returns to the lesson where they stopped: the parts come from this browser. */
export const GuestReturns: Story = {
  parameters: { guestParts: 3 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getByText("Разбор: проверяйте то, что видит пользователь."),
      ).toBeVisible(),
    );
    await expect(
      canvas.getByText("Результат описан, проверка понятна."),
    ).not.toBeVisible();
    await expect(visible(canvasElement, "Вы")).not.toBeNull();
  },
};

/**
 * A signed-in reader's parts come from the server, a removed break cannot open more parts than
 * the lesson has, and the reply carries the reader's name. A saved part tells other open tabs.
 */
export const SignedInReturns: Story = {
  parameters: { signedIn: true, account: "authenticated", serverParts: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const announced: string[] = [];
    const stop = lessonOpenedPartsChanges(accountId).subscribe((id) => {
      announced.push(id);
    });
    await waitFor(() =>
      expect(
        canvas.getByText("Проверка начинается с наблюдаемого поведения."),
      ).toBeVisible(),
    );
    const reply = canvasElement.querySelector<HTMLElement>(
      "[data-lesson-reply]",
    );
    if (reply === null) throw new Error("The reply is missing");
    await waitFor(() =>
      expect(within(reply).getByText("Кирилл Сачков")).toBeVisible(),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Пропустить" }));
    await waitFor(() => expect(saved).toEqual([3]));
    await waitFor(() => expect(announced).toHaveLength(1));
    stop();
    await expect(guestParts()).toBeNull();
  },
};

/** The first reading-state read failed; the next successful one still restores the parts. */
export const SignedInReturnsAfterFailedRead: Story = {
  parameters: {
    signedIn: true,
    account: "authenticated",
    serverParts: 2,
    failedStateReads: 1,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const second = "Проверка начинается с наблюдаемого поведения.";
    await waitFor(() => expect(failedStateReads).toBe(0));
    await expect(canvas.getByText(second)).not.toBeVisible();
    await getQueryClient().invalidateQueries({
      queryKey: ["reading-progress"],
    });
    await waitFor(() => expect(canvas.getByText(second)).toBeVisible());
    await expect(saved).toEqual([]);
  },
};

/** A saved count from a version with more breaks opens the whole current lesson. */
export const SavedCountAboveParts: Story = {
  parameters: { signedIn: true, account: "authenticated", serverParts: 9 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getByText("Результат описан, проверка понятна."),
      ).toBeVisible(),
    );
    await expect(
      canvas.getByRole("region", { name: "Термины урока" }),
    ).toBeVisible();
    await expect(saved).toEqual([]);
  },
};
