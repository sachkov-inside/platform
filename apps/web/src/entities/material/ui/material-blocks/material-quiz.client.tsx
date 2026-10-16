"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, CircleHelp, X } from "lucide-react";
import { Button } from "@/shared/ui/button";

/** Prepared reading content shared by Reader and its stories. */
interface QuizPresentation {
  readonly prompt: ReactNode;
  readonly options: readonly {
    readonly id: string;
    readonly content: ReactNode;
    readonly explanation: ReactNode;
  }[];
  readonly dontKnow: {
    readonly explanation: ReactNode;
    readonly reviewLinks: readonly string[];
  };
}

export type MaterialQuizPresentation = QuizPresentation &
  (
    | { readonly correctOptionId: string; readonly selectionMode?: undefined }
    | {
        readonly selectionMode: "multiple";
        readonly correctOptionIds: readonly string[];
      }
  );

export function MaterialQuiz(props: MaterialQuizPresentation) {
  return props.selectionMode === "multiple" ? (
    <MultipleAnswerQuiz {...props} />
  ) : (
    <SingleAnswerQuiz {...props} />
  );
}

function SingleAnswerQuiz({
  prompt,
  correctOptionId,
  options,
  dontKnow,
}: QuizPresentation & { readonly correctOptionId: string }) {
  const [answer, setAnswer] = useState<string | null>(null);
  const quizId = useId();
  const selected = options.find((option) => option.id === answer);
  const correct = options.find((option) => option.id === correctOptionId);
  const result =
    answer === "dontKnow"
      ? "Не знаю · без оценки"
      : answer === correctOptionId
        ? "Правильно"
        : "Пока неверно";
  const review = dontKnow.reviewLinks.map((href, index) => (
    <a
      key={href}
      className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      href={href}
    >
      Повторить раздел
      {dontKnow.reviewLinks.length > 1 ? ` ${String(index + 1)}` : ""}
    </a>
  ));
  return (
    <section
      aria-label="Проверьте понимание"
      data-material-quiz
      className="my-6 rounded-xl border p-3 text-sm leading-[1.55] sm:my-8 sm:p-5 sm:text-base [&_p]:min-h-0 [&_p]:mt-3 [&_p:first-child]:mt-0"
    >
      <h2
        data-quiz-heading
        className="flex items-center gap-2 text-sm font-semibold sm:text-base"
      >
        <span className="grid size-6 shrink-0 sm:size-8 place-items-center rounded-lg bg-action text-accent-foreground">
          <CircleHelp aria-hidden="true" className="size-4 sm:size-5" />
        </span>
        Проверьте понимание
      </h2>
      <div className="mt-3">{prompt}</div>
      <div className="mt-4 space-y-2" role="group" aria-label="Выберите ответ">
        {options.map((option, index) => {
          const chosen = answer === option.id;
          const optionResult = !chosen
            ? undefined
            : option.id === correctOptionId
              ? "correct"
              : "incorrect";
          return (
            <div
              key={option.id}
              data-quiz-option
              data-result={optionResult}
              className="relative flex min-h-11 w-full gap-2 rounded-lg border border-border bg-card px-2.5 py-2 pr-8 text-left text-sm leading-[1.5] sm:px-3 sm:pr-9 sm:text-base"
            >
              <button
                type="button"
                aria-pressed={chosen}
                aria-labelledby={`${quizId}-number-${String(index)} ${quizId}-option-${String(index)}`}
                aria-describedby={chosen ? `${quizId}-feedback` : undefined}
                onClick={() => {
                  setAnswer(option.id);
                }}
                className={`absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring${chosen ? "" : " hover:bg-secondary/50"}`}
              />
              <span
                id={`${quizId}-number-${String(index)}`}
                className="pointer-events-none relative font-semibold"
              >
                {index + 1}.
              </span>
              <div
                id={`${quizId}-option-${String(index)}`}
                className="pointer-events-none relative min-w-0 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_summary]:pointer-events-auto"
              >
                {option.content}
              </div>
              {!chosen ? null : optionResult === "correct" ? (
                <Check
                  aria-hidden="true"
                  className="absolute right-3 top-3 size-4"
                />
              ) : (
                <X
                  aria-hidden="true"
                  className="absolute right-3 top-3 size-4"
                />
              )}
            </div>
          );
        })}
        <Button
          className="min-h-11 px-2.5 text-sm sm:px-3"
          variant="ghost"
          aria-pressed={answer === "dontKnow"}
          onClick={() => {
            setAnswer("dontKnow");
          }}
        >
          Не знаю
        </Button>
      </div>
      <div aria-live="polite" id={`${quizId}-feedback`}>
        {answer === null ? null : (
          <div className="mt-3 border-t border-border pt-3" data-quiz-feedback>
            <p
              className="text-sm font-semibold"
              style={{
                color:
                  answer === "dontKnow"
                    ? "var(--foreground)"
                    : answer === correctOptionId
                      ? "var(--callout-good)"
                      : "var(--callout-bad)",
              }}
            >
              {result}
            </p>
            {selected === undefined ? (
              <>
                <p className="mt-2 text-sm font-semibold">Правильный ответ:</p>
                <div className="mt-1">{correct?.content}</div>
                <div className="mt-2">{correct?.explanation}</div>
                <div className="mt-2">{dontKnow.explanation}</div>
                {review}
              </>
            ) : (
              <div className="mt-2">{selected.explanation}</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function MultipleAnswerQuiz({
  prompt,
  options,
  correctOptionIds,
  dontKnow,
}: QuizPresentation & { readonly correctOptionIds: readonly string[] }) {
  const quizId = useId();
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [result, setResult] = useState<
    "correct" | "incorrect" | "dontKnow" | null
  >(null);
  return (
    <section
      data-material-quiz
      aria-label="Проверь понимание"
      className="my-6 rounded-xl border p-3 text-sm leading-[1.55] sm:my-8 sm:p-5 sm:text-base [&_p]:min-h-0 [&_p]:mt-3 [&_p:first-child]:mt-0"
    >
      <h2
        data-quiz-heading
        className="flex items-center gap-2 text-sm font-semibold sm:text-base"
      >
        <span className="grid size-6 shrink-0 sm:size-8 place-items-center rounded-lg bg-action text-accent-foreground">
          <CircleHelp aria-hidden="true" className="size-4 sm:size-5" />
        </span>
        Проверь понимание
      </h2>
      <div className="mt-3">{prompt}</div>
      <fieldset className="mt-4 min-w-0 space-y-2">
        <legend className="mb-2 text-sm text-muted-foreground">
          Выбери все подходящие варианты.
        </legend>
        {options.map((option, index) => (
          <div
            key={option.id}
            data-quiz-option
            className="relative flex min-h-11 w-full items-start gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left text-sm leading-[1.5] sm:px-3 sm:text-base"
          >
            <input
              type="checkbox"
              id={`${quizId}-option-${String(index)}`}
              checked={selectedIds.includes(option.id)}
              aria-labelledby={`${quizId}-label-${String(index)}`}
              className="relative mt-1 size-4 shrink-0 accent-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onChange={(event) => {
                setSelectedIds(
                  event.target.checked
                    ? [...selectedIds, option.id]
                    : selectedIds.filter((id) => id !== option.id),
                );
                setResult(null);
              }}
            />
            <label
              htmlFor={`${quizId}-option-${String(index)}`}
              className="absolute inset-0 cursor-pointer rounded-lg hover:bg-secondary/50"
            />
            <div
              id={`${quizId}-label-${String(index)}`}
              className="pointer-events-none relative min-w-0 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_summary]:pointer-events-auto"
            >
              {option.content}
            </div>
          </div>
        ))}
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={selectedIds.length === 0}
          onClick={() => {
            setResult(
              selectedIds.length === correctOptionIds.length &&
                correctOptionIds.every((id) => selectedIds.includes(id))
                ? "correct"
                : "incorrect",
            );
          }}
        >
          Проверить
        </Button>
        <Button
          variant="ghost"
          aria-pressed={result === "dontKnow"}
          onClick={() => {
            setResult("dontKnow");
          }}
        >
          Не знаю
        </Button>
      </div>
      <div aria-live="polite" id={`${quizId}-feedback`}>
        {result === null ? null : (
          <div data-quiz-feedback className="mt-3 border-t border-border pt-3">
            <p
              className="flex items-center gap-2 text-sm font-semibold"
              style={{
                color:
                  result === "dontKnow"
                    ? "var(--foreground)"
                    : result === "correct"
                      ? "var(--callout-good)"
                      : "var(--callout-bad)",
              }}
            >
              {result === "dontKnow" ? (
                <CircleHelp aria-hidden="true" className="size-4" />
              ) : result === "correct" ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <X aria-hidden="true" className="size-4" />
              )}
              {result === "dontKnow"
                ? "Не знаю · без оценки"
                : result === "correct"
                  ? "Правильно"
                  : "Пока неверно"}
            </p>
            <p className="mt-2 text-sm font-semibold">Разбор ответов:</p>
            <ul className="mt-2 space-y-3">
              {options.map((option) => (
                <li key={option.id}>
                  <div className="flex items-start gap-2">
                    {correctOptionIds.includes(option.id) ? (
                      <Check
                        aria-label="Подходит"
                        className="mt-1 size-4 shrink-0"
                      />
                    ) : (
                      <X
                        aria-label="Не подходит"
                        className="mt-1 size-4 shrink-0"
                      />
                    )}
                    <div className="min-w-0">{option.content}</div>
                  </div>
                  <div className="mt-1 pl-6">{option.explanation}</div>
                </li>
              ))}
            </ul>
            <div className="mt-3">{dontKnow.explanation}</div>
            {dontKnow.reviewLinks.map((href, index) => (
              <a
                key={href}
                href={href}
                className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
              >
                Повторить раздел
                {dontKnow.reviewLinks.length > 1 ? ` ${String(index + 1)}` : ""}
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
