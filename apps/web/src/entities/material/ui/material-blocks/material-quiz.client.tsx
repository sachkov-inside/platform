"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, CircleHelp, X } from "lucide-react";
import { Button } from "@/shared/ui/button";

/** Prepared reading content shared by Reader and its stories. */
export interface MaterialQuizPresentation {
  readonly prompt: ReactNode;
  readonly correctOptionId: string;
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

export function MaterialQuiz({
  prompt,
  correctOptionId,
  options,
  dontKnow,
}: MaterialQuizPresentation) {
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
      className="my-8 rounded-xl border p-4 text-base leading-relaxed sm:p-5"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-action text-accent-foreground">
          <CircleHelp aria-hidden="true" className="size-5" />
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
              className="relative flex min-h-11 w-full gap-3 rounded-lg border border-border bg-card px-3 py-2 pr-9 text-left"
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
          className="min-h-11 px-3"
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
