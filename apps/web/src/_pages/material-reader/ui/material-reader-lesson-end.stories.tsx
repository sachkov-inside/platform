import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { z } from "zod";

import {
  exerciseFingerprint,
  materialExercises,
  type RenderedBlock,
} from "@inside/material-blocks";
import {
  exerciseAttemptChanges,
  LessonExerciseAttempts,
  lessonExercises,
  SavedLessonExerciseSummary,
} from "@/features/exercise-attempts";
import {
  lessonRatingChanges,
  SavedLessonRating,
} from "@/features/lesson-rating";
import {
  SavedLessonTermDeck,
  termMarkChanges,
} from "@/features/lesson-term-deck";
import {
  ReadingProgressProvider,
  SavedReadingAction,
} from "@/features/reading-progress";
import { getQueryClient } from "@/shared/api/query-client";
import {
  materialReaderHref,
  parseMaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { expectPhoneLayout } from "@/storybook/phone-layout";
import { accountPresentationResponse } from "@/storybook/account.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { MaterialReaderView } from "./material-reader-view";

const materialId = "02000000-0000-4000-8000-000000002118";
const accountId = "20000000-0000-4000-8000-000000002118";

const paragraph = (text: string): RenderedBlock => ({
  kind: "paragraph",
  content: [{ kind: "text", text, marks: [] }],
});

const body: RenderedBlock[] = [
  paragraph("Проверка начинается с наблюдаемого поведения."),
  {
    kind: "quiz",
    id: "observable-result",
    reveal: "none",
    question: [paragraph("Что лучше проверяет результат?")],
    selectionMode: "single",
    options: [
      {
        id: "visible",
        content: [paragraph("Пользователь видит запись.")],
        correct: true,
      },
      {
        id: "stack",
        content: [paragraph("Код написан на TypeScript.")],
        correct: false,
        explanation: [paragraph("Неверно. Это выбор инструмента.")],
      },
    ],
  },
];
const [quiz] = materialExercises(body);
if (quiz === undefined) throw new Error("The lesson needs its exercise");

const term = {
  id: "observable-behaviour",
  title: "Наблюдаемое поведение",
  englishTitle: null,
  shortDefinition: "То, что видит пользователь.",
  fullDefinition: "То, что видит пользователь системы.",
};

/** What the backend holds for the signed-in reader; another tab may change it. */
const backend = {
  rating: null as "like" | "dislike" | null,
  marks: [] as { termId: string; mark: "known" | "review"; markedAt: string }[],
  attempts: [] as unknown[],
  recorded: [] as string[],
};

function attempt(optionId: string) {
  return {
    exerciseId: quiz?.id,
    fingerprint: quiz === undefined ? "" : exerciseFingerprint(quiz),
    answer: { kind: "options", optionIds: [optionId] },
    result: optionId === "visible" ? "correct" : "incorrect",
    firstForVersion: true,
    attemptedAt: "2026-11-13T09:00:00.000Z",
  };
}

const body$ = async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = input instanceof Request ? await input.text() : init?.body;
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(typeof raw === "string" ? raw : "{}"));
};

/** Who the shell has resolved; a story flips it to an Account after the reader answered. */
const identity = new EventTarget();

function ReaderIdentity({
  initiallyResolved,
  children,
}: {
  readonly initiallyResolved: boolean;
  readonly children: React.ReactNode;
}) {
  const [resolved, setResolved] = useState(initiallyResolved);
  useEffect(() => {
    const resolve = () => {
      setResolved(true);
    };
    identity.addEventListener("resolve", resolve);
    return () => {
      identity.removeEventListener("resolve", resolve);
    };
  }, []);
  return (
    <ReadingProgressProvider accountId={accountId} resolved={resolved}>
      {children}
    </ReadingProgressProvider>
  );
}

const environment = publicPageEnvironment("/materials/lesson-end", {
  account: "authenticated",
});
const meta = {
  ...environment,
  id: "pages-material-reader-lesson-end",
  title: "Pages/Material Reader/Lesson End",
  component: MaterialReaderView,
  beforeEach: () => {
    getQueryClient().clear();
    environment.beforeEach();
    backend.rating = null;
    backend.marks = [];
    backend.attempts = [];
    backend.recorded = [];
    return fetchBeforeRender(async (input, init) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      ).pathname;
      if (path === "/api/account") return accountPresentationResponse();
      if (path === "/api/reading-progress/states") {
        const { materialIds } = z
          .object({ materialIds: z.array(z.string()) })
          .parse(await body$(input, init));
        return Response.json({
          kind: "ready",
          states: materialIds.map((id) => ({
            materialId: id,
            isRead: false,
            version: 0,
            readAt: null,
            updatedAt: null,
            updateNote: null,
            openedParts: null,
          })),
        });
      }
      if (path === "/api/lesson-ratings/query")
        return Response.json({ kind: "ready", rating: backend.rating });
      if (path === "/api/lesson-ratings/rating") {
        const { rating } = z
          .object({ rating: z.enum(["like", "dislike"]).nullable() })
          .parse(await body$(input, init));
        backend.rating = rating;
        return Response.json({ kind: "ready", rating });
      }
      if (path === "/api/glossary/marks/states")
        return Response.json({ kind: "ready", marks: backend.marks });
      if (path === "/api/glossary/marks/state") {
        const { termId, mark } = z
          .object({ termId: z.string(), mark: z.enum(["known", "review"]) })
          .parse(await body$(input, init));
        const saved = { termId, mark, markedAt: "2026-11-13T09:00:00.000Z" };
        backend.marks = [saved];
        return Response.json({ kind: "ready", mark: saved });
      }
      if (path === "/api/exercise-attempts/query")
        return Response.json({ kind: "ready", attempts: backend.attempts });
      if (path === "/api/exercise-attempts/attempt") {
        const { answer } = z
          .object({ answer: z.object({ optionIds: z.array(z.string()) }) })
          .parse(await body$(input, init));
        const [optionId = ""] = answer.optionIds;
        backend.recorded.push(optionId);
        const saved = attempt(optionId);
        backend.attempts = [saved];
        return Response.json({ kind: "ready", attempt: saved });
      }
      return Response.json({ kind: "unavailable" }, { status: 503 });
    })();
  },
  decorators: [
    (Story, context) => (
      <ReaderIdentity
        initiallyResolved={context.parameters["identityPending"] !== true}
      >
        <Story />
      </ReaderIdentity>
    ),
    ...environment.decorators,
  ],
  args: {
    body,
    primaryVideo: null,
    termDeck: <SavedLessonTermDeck terms={[term]} />,
    exerciseSummary: <SavedLessonExerciseSummary />,
    lessonRating: <SavedLessonRating materialId={materialId} />,
    exerciseScope: (lesson) => (
      <LessonExerciseAttempts
        materialId={materialId}
        exercises={lessonExercises(body)}
        signInHref="/account"
      >
        {lesson}
      </LessonExerciseAttempts>
    ),
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
      slug: "lesson-end",
      summary: "Учебная фикстура конца урока.",
      tags: [],
      title: "Результат и его проверка",
      topic: { name: "AI-first engineering", slug: "ai-first-engineering" },
    },
  },
} satisfies Meta<typeof MaterialReaderView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Opens the collapsed «Термины урока · N» row of the finish card. */
async function openTerms(canvasElement: HTMLElement) {
  await userEvent.click(
    await within(canvasElement).findByRole("button", {
      name: /^Термины урока · \d+$/u,
    }),
  );
}

/** The finish card of the lesson; the page has one. */
function finishCard(canvasElement: HTMLElement): HTMLElement {
  const card = canvasElement.querySelector<HTMLElement>("[data-lesson-finish]");
  if (card === null) throw new Error("The lesson finish card is missing");
  return card;
}

/** Collects announcements of one fact channel while a story runs. */
function heard(channel: {
  subscribe: (on: (id: string) => void) => () => void;
}) {
  const ids: string[] = [];
  channel.subscribe((id) => {
    ids.push(id);
  });
  return ids;
}

/** Each write of the lesson end tells the reader's other open tabs. */
export const WritesTellOtherTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ratings = heard(lessonRatingChanges(accountId));
    const marks = heard(termMarkChanges(accountId));
    const attempts = heard(exerciseAttemptChanges(accountId));

    await userEvent.click(
      await canvas.findByRole("button", { name: /Пользователь видит запись/u }),
    );
    await waitFor(() => expect(attempts).toHaveLength(1));
    await openTerms(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Знаю" }));
    await waitFor(() => expect(marks).toHaveLength(1));
    await userEvent.click(
      await canvas.findByRole("button", { name: "Понравился" }),
    );
    await waitFor(() => expect(ratings).toHaveLength(1));
  },
};

/**
 * Another tab rated the lesson, marked the term and solved the exercise: this tab shows it after
 * the announcement, so «Понравился» here does not remove a rating it never showed.
 */
export const FollowsAnotherTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const like = await canvas.findByRole("button", { name: "Понравился" });
    await expect(like).toHaveAttribute("aria-pressed", "false");

    backend.rating = "like";
    backend.marks = [
      {
        termId: term.id,
        mark: "known",
        markedAt: "2026-11-13T09:00:00.000Z",
      },
    ];
    backend.attempts = [attempt("visible")];
    lessonRatingChanges(accountId).announce();
    termMarkChanges(accountId).announce();
    exerciseAttemptChanges(accountId).announce();

    await waitFor(() => expect(like).toHaveAttribute("aria-pressed", "true"));
    await openTerms(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Знаю" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await waitFor(() =>
      expect(canvas.getByText("Упражнения: 1 из 1")).toBeVisible(),
    );
    await expect(
      canvas.getByRole("heading", { name: "Урок пройден" }),
    ).toBeVisible();
  },
};

/** An answer given before the shell knows the reader is saved once it does. */
export const AnswerBeforeIdentityIsSaved: Story = {
  parameters: { identityPending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: /Пользователь видит запись/u }),
    );
    await expect(backend.recorded).toEqual([]);
    identity.dispatchEvent(new Event("resolve"));
    await waitFor(() => expect(backend.recorded).toEqual(["visible"]));
  },
};

const programme = productProgrammeHref("ai-engineering");
const courseContext = {
  currentPosition: 2,
  totalMaterials: 3,
  product: { name: "AI Engineering", href: programme },
  previous: {
    title: "Первый урок",
    href: materialReaderHref("first", programme),
  },
  next: {
    title: "Следующий урок",
    href: materialReaderHref("next", programme),
  },
};

/**
 * «Финиш урока» outside a course: one quiet card with the unsolved exercise, the lesson terms row
 * and the rating; the reading panel under it stays as it was.
 */
export const FinishOutsideCourse: Story = {
  play: async ({ canvasElement }) => {
    const card = within(finishCard(canvasElement));
    await expect(
      await card.findByRole("heading", { name: "Конец урока" }),
    ).toBeVisible();
    await expect(card.getByText("Упражнения: 0 из 1")).toBeVisible();
    await expect(
      card.getByRole("link", { name: "Решить упражнение 1" }),
    ).toHaveAttribute("href", `#exercise-${quiz.id}`);
    const terms = card.getByRole("button", { name: "Термины урока · 1" });
    await expect(terms).toHaveAttribute("aria-expanded", "false");
    await expect(
      await card.findByRole("group", { name: "Как вам урок?" }),
    ).toBeVisible();
    await expect(
      within(canvasElement).getByRole("navigation", {
        name: "Действия в конце материала",
      }),
    ).toBeVisible();
    await expect(
      within(canvasElement)
        .getByRole("navigation", { name: "Действия в конце материала" })
        .closest("[data-lesson-finish]"),
    ).toBeNull();
  },
};

/**
 * Inside a course the card replaces the reading panel under the lesson: «Изучено» and the main
 * «Дальше»; «Назад» and «Сохранить» stay in the panel above the lesson.
 */
export const FinishInCourse: Story = {
  args: {
    returnTarget: parseMaterialReaderReturnTarget(programme),
    productContext: courseContext,
    readingAction: (
      <SavedReadingAction compact format="guide" materialId={materialId} />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ends = canvas.getAllByRole("navigation", {
      name: "Действия в конце материала",
    });
    await expect(ends).toHaveLength(1);
    const [end] = ends;
    if (end === undefined) throw new Error("The finish actions are missing");
    await expect(finishCard(canvasElement).contains(end)).toBe(true);
    await expect(
      within(end).getByRole("link", { name: "Дальше" }),
    ).toHaveAttribute("href", materialReaderHref("next", programme));
    await expect(
      within(end).getByRole("button", { name: "Изучено" }),
    ).toBeVisible();
    for (const name of ["Назад", "Сохранить"])
      await expect(within(end).queryByText(name)).toBeNull();
    await userEvent.click(
      await canvas.findByRole("button", { name: /Пользователь видит запись/u }),
    );
    await waitFor(() =>
      expect(
        within(finishCard(canvasElement)).getByRole("heading", {
          name: "Урок пройден",
        }),
      ).toBeVisible(),
    );
    await expect(
      within(finishCard(canvasElement)).queryByRole("link", {
        name: /^Решить упражнение/u,
      }),
    ).toBeNull();
  },
};

export const FinishInCoursePhone: Story = {
  ...FinishInCourse,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async (context) => {
    await FinishInCourse.play?.(context);
    await openTerms(context.canvasElement);
    const end = finishCard(context.canvasElement).parentElement;
    if (end === null) throw new Error("The finish card has no frame");
    await expectPhoneLayout(end, "[data-lesson-finish]");
    // On a phone «Дальше» is the card's main button across its whole width.
    const actions = within(finishCard(context.canvasElement)).getByRole(
      "navigation",
      { name: "Действия в конце материала" },
    );
    const next = within(actions).getByRole("link", { name: "Дальше" });
    const row = actions.getBoundingClientRect();
    await expect(next.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      row.width - 1,
    );
    await expect(next.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      48,
    );
  },
};

export const FinishInCoursePhone360: Story = {
  ...FinishInCoursePhone,
  globals: { viewport: { value: "mobile360", isRotated: false } },
};

/** A lesson without exercises and terms: the card keeps the plain heading and the rating. */
export const FinishWithoutExercises: Story = {
  args: {
    body: [paragraph("Короткий урок без упражнений.")],
    termDeck: <SavedLessonTermDeck terms={[]} />,
    exerciseScope: (lesson) => (
      <LessonExerciseAttempts
        materialId={materialId}
        exercises={[]}
        signInHref="/account"
      >
        {lesson}
      </LessonExerciseAttempts>
    ),
  },
  play: async ({ canvasElement }) => {
    const card = within(finishCard(canvasElement));
    await expect(
      card.getByRole("heading", { name: "Конец урока" }),
    ).toBeVisible();
    await expect(card.queryByText(/^Упражнения:/u)).toBeNull();
    await expect(
      card.queryByRole("button", { name: /^Термины урока/u }),
    ).toBeNull();
    await expect(
      await card.findByRole("group", { name: "Как вам урок?" }),
    ).toBeVisible();
  },
};

/**
 * The last lesson of a course has no next step: the card leads back to the course programme with
 * the main «К программе» in place of «Дальше» (решение владельца 14.11.2026).
 */
export const FinishOnLastLesson: Story = {
  args: {
    returnTarget: parseMaterialReaderReturnTarget(programme),
    productContext: { ...courseContext, currentPosition: 3, next: null },
    readingAction: (
      <SavedReadingAction compact format="guide" materialId={materialId} />
    ),
  },
  play: async ({ canvasElement }) => {
    const end = within(finishCard(canvasElement)).getByRole("navigation", {
      name: "Действия в конце материала",
    });
    await expect(
      within(end).getByRole("link", { name: "К программе" }),
    ).toHaveAttribute("href", programme);
    await expect(
      within(end).queryByRole("link", { name: "Дальше" }),
    ).toBeNull();
  },
};

/**
 * Scrolled to the very end, nothing covers the bottom of the lesson: the page itself never scrolls
 * past the application frame, so no white band rises from under it (owner, 14.11.2026).
 */
export const LessonEndNotCovered: Story = {
  ...FinishInCourse,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const document = canvasElement.ownerDocument;
    const card = finishCard(canvasElement);
    await within(card).findByRole("group", { name: "Как вам урок?" });
    const scroller = document.querySelector<HTMLElement>(
      "[data-application-content]",
    );
    if (scroller === null) throw new Error("The application frame is missing");
    scroller.scrollTop = scroller.scrollHeight;
    document.scrollingElement?.scrollTo(
      0,
      document.documentElement.scrollHeight,
    );
    const root = document.documentElement;
    if (getComputedStyle(scroller).overflowY === "auto")
      // The frame scrolls the lesson; the page around it has nothing to scroll.
      await expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight);
    await waitFor(() => {
      const box = card.getBoundingClientRect();
      return expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    });
    const box = card.getBoundingClientRect();
    // Points clear of the rounded corners, along the card's last line.
    for (const x of [box.left + 24, box.left + box.width / 2, box.right - 24]) {
      const hit = document.elementFromPoint(x, box.bottom - 12);
      await expect(hit !== null && card.contains(hit)).toBe(true);
    }
  },
};
export const LessonEndNotCoveredPhone: Story = {
  ...LessonEndNotCovered,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
