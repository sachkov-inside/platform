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
import { ReadingProgressProvider } from "@/features/reading-progress";
import { getQueryClient } from "@/shared/api/query-client";
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
      if (path === "/api/reading-progress/states")
        return Response.json({ kind: "ready", states: [] });
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
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Знаю" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await waitFor(() =>
      expect(canvas.getByText("Упражнения: 1 из 1 решены")).toBeVisible(),
    );
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
