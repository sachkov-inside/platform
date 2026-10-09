"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  ReaderBlock,
  MaterialReaderMetadata,
} from "@/_pages/material-reader/model/material-reader-view";
import { Button } from "@/shared/ui/button";
import { MaterialReaderView } from "../material-reader-view";
import { quizFixture, readerBlocks } from "./reader-blocks.fixture";

/**
 * Throwaway #1277, Part of #940: three quiz structures inside the existing Reader.
 * THESIS: compare visible inline choices, optional disclosure, and a question/result spread.
 * OWN-WORLD: inherit Platform tokens, Manrope, Button, Reader and application shell.
 * STORY: answer, learn why, retry or review the preceding section; continue reading freely.
 * FIRST VIEWPORT: real Reader header and narrative; quiz stays at its Content v2 position.
 * FORM: A inline / B disclosure / C spread. Code-led local extension; no identity change.
 * FINISH: responsive captures, interaction proof, independent review; owner acceptance remains open.
 */
export type QuizVariant = "A" | "B" | "C";
export type QuizState =
  "unanswered" | "correct" | "incorrect" | "dontKnow" | "all";
const variants: readonly QuizVariant[] = ["A", "B", "C"];
const names = {
  A: "Встроенный блок",
  B: "Раскрываемая проверка",
  C: "Разворот вопроса",
};
const material: MaterialReaderMetadata = {
  materialId: "02000000-0000-4000-8000-000000001277",
  contentVersion: 1,
  access: "free",
  cover: null,
  format: { name: "Гайд", slug: "guide" },
  difficulty: "basic",
  outcomes: [],
  publishedAt: "2026-10-09T09:00:00.000Z",
  seriesMemberships: [],
  slug: "quiz-prototype",
  summary:
    "Учебная фикстура: как поставить агенту задачу и проверить результат.",
  tags: [],
  title: "Задача начинается с результата",
  topic: { name: "AI-first engineering", slug: "ai-first-engineering" },
};

/** Fixture-only adapter for this fixture's plain paragraphs and level-two headings. */
const body: ReaderBlock[] = readerBlocks.flatMap((block) =>
  block.kind === "quiz"
    ? []
    : block.markdown.split("\n\n").map((text): ReaderBlock =>
        text.startsWith("## ")
          ? {
              kind: "heading",
              level: 2,
              content: [{ kind: "text", text: text.slice(3), marks: [] }],
            }
          : {
              kind: "paragraph",
              content: [{ kind: "text", text, marks: [] }],
            },
      ),
);
const quizAt = readerBlocks[0].markdown.split("\n\n").length;

function initialAnswer(state: QuizState): string | null {
  if (state === "correct" || state === "all")
    return quizFixture.correctOptionId;
  if (state === "incorrect") return "option-1";
  if (state === "dontKnow") return "dontKnow";
  return null;
}

export function QuizReaderPrototype({
  initialVariant = "A",
  initialState = "unanswered",
}: {
  readonly initialVariant?: QuizVariant;
  readonly initialState?: QuizState;
}) {
  const [variant, setVariant] = useState(initialVariant);
  const [state, setState] = useState(initialState);
  useEffect(() => {
    const read = () => {
      const key = new URLSearchParams(window.location.search).get("variant");
      if (key === "A" || key === "B" || key === "C") setVariant(key);
    };
    read();
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("popstate", read);
    };
  }, []);
  const change = (next: QuizVariant) => {
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !(event.target instanceof HTMLElement) ||
        event.target.closest(
          "input,textarea,select,button,a,summary,[contenteditable]",
        )
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next =
        variants[
          (variants.indexOf(variant) + (event.key === "ArrowRight" ? 1 : 2)) %
            variants.length
        ];
      if (next !== undefined) change(next);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [variant]);
  return (
    <div className="pb-32">
      <div className="mx-auto mb-6 max-w-[43rem] rounded-xl bg-secondary p-4 text-sm">
        <p className="font-semibold">Прототип #1277 · учебная фикстура</p>
        <p className="mt-1">Ответы не сохраняются. Вид квиза выбирает автор.</p>
        <label className="mt-3 flex flex-wrap items-center gap-2">
          Сценарий для просмотра
          <select
            className="min-h-11 rounded-lg border border-input bg-background p-2"
            value={state}
            onChange={(event) => {
              setState(
                event.target.value === "correct"
                  ? "correct"
                  : event.target.value === "incorrect"
                    ? "incorrect"
                    : event.target.value === "dontKnow"
                      ? "dontKnow"
                      : event.target.value === "all"
                        ? "all"
                        : "unanswered",
              );
            }}
          >
            <option value="unanswered">Без ответа</option>
            <option value="correct">Правильный ответ</option>
            <option value="incorrect">Ошибка</option>
            <option value="dontKnow">Не знаю</option>
            <option value="all">Все объяснения</option>
          </select>
        </label>
      </div>
      <MaterialReaderView
        body={body}
        material={material}
        primaryVideo={null}
        modeHint={{
          at: quizAt,
          node: (
            <Quiz
              key={`${variant}-${state}`}
              variant={variant}
              initialState={state}
            />
          ),
        }}
      />
      <nav
        aria-label="Варианты прототипа"
        className="fixed inset-x-3 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-2xl bg-primary p-2 text-primary-foreground shadow-lg"
      >
        <Button
          variant="ghost"
          aria-label="Предыдущий вариант"
          onClick={() => {
            change(variants[(variants.indexOf(variant) + 2) % 3] ?? "A");
          }}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <span className="min-w-0 text-center text-sm" aria-live="polite">
          {variant} · {names[variant]}
        </span>
        <Button
          variant="ghost"
          aria-label="Следующий вариант"
          onClick={() => {
            change(variants[(variants.indexOf(variant) + 1) % 3] ?? "A");
          }}
        >
          <ArrowRight aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}

function Quiz({
  variant,
  initialState,
}: {
  readonly variant: QuizVariant;
  readonly initialState: QuizState;
}) {
  const [answer, setAnswer] = useState<string | null>(() =>
    initialAnswer(initialState),
  );
  const [all, setAll] = useState(initialState === "all");
  const quizFocus = useRef<HTMLElement>(null);
  const resultFocus = useRef<HTMLDivElement>(null);
  const previousAnswer = useRef(answer);
  useEffect(() => {
    if (previousAnswer.current !== answer) {
      if (answer === null) quizFocus.current?.querySelector("button")?.focus();
      else if (variant === "C") resultFocus.current?.focus();
    }
    previousAnswer.current = answer;
  }, [variant, answer]);
  const choose = (id: string) => {
    setAnswer(id);
    setAll(false);
  };
  const retry = () => {
    setAnswer(null);
    setAll(false);
  };
  const result =
    answer === null
      ? "Без ответа"
      : answer === "dontKnow"
        ? "Не знаю · без оценки"
        : answer === quizFixture.correctOptionId
          ? "Правильно"
          : "Пока неверно";
  const choices = <Choices answer={answer} choose={choose} />;
  const feedback = (
    <Feedback
      answer={answer}
      result={result}
      all={all}
      setAll={setAll}
      retry={retry}
    />
  );
  return (
    <section
      aria-label="Проверьте понимание"
      ref={quizFocus}
      data-quiz-variant={variant}
      className="my-10 text-base leading-relaxed"
    >
      {variant === "A" ? (
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-7">
          <h3 className="text-xl font-semibold">Проверьте понимание</h3>
          <p className="mt-3">{quizFixture.promptMarkdown}</p>
          <div className="mt-5">{choices}</div>
          {feedback}
        </div>
      ) : variant === "B" ? (
        <details
          open={initialState !== "unanswered"}
          className="border-y border-border py-4"
        >
          <summary className="cursor-pointer py-2 font-semibold focus-visible:outline-ring">
            <h3 className="inline text-lg">
              Проверьте себя: что доказывает результат?
            </h3>
          </summary>
          <p className="mt-4">{quizFixture.promptMarkdown}</p>
          <div className="mt-4">{choices}</div>
          {feedback}
        </details>
      ) : (
        <div className="border-y border-border py-7 sm:grid sm:grid-cols-2 sm:gap-7">
          <div>
            <h3 className="text-xl font-semibold">Остановитесь на вопросе</h3>
            <p className="mt-4">{quizFixture.promptMarkdown}</p>
            <p className="mt-4 text-sm text-muted-foreground">
              Один ответ. Можно продолжить чтение в любой момент.
            </p>
          </div>
          <div
            className="mt-5 sm:mt-0 focus-visible:outline-ring"
            ref={resultFocus}
            tabIndex={-1}
          >
            {answer === null ? choices : feedback}
          </div>
        </div>
      )}
      <p
        className="mt-3 text-sm text-muted-foreground"
        data-quiz-state
        aria-live="polite"
      >
        Состояние: {result}
        {all ? " · все объяснения открыты" : ""}
      </p>
    </section>
  );
}

function Choices({
  answer,
  choose,
}: {
  readonly answer: string | null;
  readonly choose: (id: string) => void;
}) {
  return (
    <div className="space-y-2" role="group" aria-label="Выберите ответ">
      {quizFixture.options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={answer === option.id}
          onClick={() => {
            choose(option.id);
          }}
          className="flex min-h-12 w-full gap-3 rounded-xl border border-border px-4 py-3 text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-secondary"
        >
          <span className="font-semibold">{index + 1}.</span>
          <span>{option.markdown}</span>
        </button>
      ))}
      <Button
        className="min-h-12"
        variant="ghost"
        aria-pressed={answer === "dontKnow"}
        onClick={() => {
          choose("dontKnow");
        }}
      >
        Не знаю
      </Button>
    </div>
  );
}

function Feedback({
  answer,
  result,
  all,
  setAll,
  retry,
}: {
  readonly answer: string | null;
  readonly result: string;
  readonly all: boolean;
  readonly setAll: (open: boolean) => void;
  readonly retry: () => void;
}) {
  const selected = quizFixture.options.find((option) => option.id === answer);
  const correct = quizFixture.options.find(
    (option) => option.id === quizFixture.correctOptionId,
  );
  return (
    <div aria-live="polite" aria-atomic="true">
      {answer === null ? null : (
        <div className="mt-5 rounded-xl bg-secondary p-4">
          <p
            className="font-semibold"
            style={{
              color:
                answer === "dontKnow"
                  ? "var(--foreground)"
                  : answer === quizFixture.correctOptionId
                    ? "var(--callout-good)"
                    : "var(--callout-bad)",
            }}
          >
            {result}
          </p>
          {selected === undefined ? (
            <>
              <p className="mt-2">Правильный ответ: {correct?.markdown}</p>
              <p className="mt-2">{correct?.explanationMarkdown}</p>
              <p className="mt-2">{quizFixture.dontKnow.explanationMarkdown}</p>
            </>
          ) : (
            <>
              <p className="mt-2">Ваш ответ: {selected.markdown}</p>
              <p className="mt-2">{selected.explanationMarkdown}</p>
            </>
          )}
          {answer === "dontKnow" ? (
            <a
              className="mt-3 inline-flex min-h-11 items-center underline underline-offset-4"
              href={quizFixture.dontKnow.reviewLinks[0]}
            >
              Повторить раздел «Проверяемый результат»
            </a>
          ) : null}
        </div>
      )}
      {answer === null ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={retry}>
            Ответить ещё раз
          </Button>
          <Button
            variant="ghost"
            aria-expanded={all}
            onClick={() => {
              setAll(!all);
            }}
          >
            {all ? "Скрыть объяснения" : "Все объяснения"}
          </Button>
        </div>
      )}
      {all ? (
        <div className="mt-5 space-y-4 border-t border-border pt-4">
          <h4 className="font-semibold">Разбор всех вариантов</h4>
          {quizFixture.options.map((option, index) => (
            <div key={option.id}>
              <p className="font-semibold">
                {index + 1}. {option.markdown}
              </p>
              <p className="mt-1">{option.explanationMarkdown}</p>
            </div>
          ))}
          <p>
            <strong>Не знаю.</strong> {quizFixture.dontKnow.explanationMarkdown}
          </p>
          <a
            className="inline-flex min-h-11 items-center underline underline-offset-4"
            href={quizFixture.dontKnow.reviewLinks[0]}
          >
            Повторить раздел «Проверяемый результат»
          </a>
        </div>
      ) : null}
    </div>
  );
}
