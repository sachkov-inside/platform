"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/shared/ui/button";

/** Prepared reading content; Reader and stories use the same accepted #1277 A interface. */
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
  const [all, setAll] = useState(false);
  const quizId = useId();
  const firstChoice = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.id === answer);
  const correct = options.find((option) => option.id === correctOptionId);
  const result =
    answer === null
      ? "Без ответа"
      : answer === "dontKnow"
        ? "Не знаю · без оценки"
        : answer === correctOptionId
          ? "Правильно"
          : "Пока неверно";
  const choose = (id: string) => {
    setAnswer(id);
    setAll(false);
  };
  const retry = () => {
    setAnswer(null);
    setAll(false);
    firstChoice.current?.focus();
  };
  const review = dontKnow.reviewLinks.map((href, index) => (
    <a
      key={href}
      className="mt-3 inline-flex min-h-11 items-center underline underline-offset-4"
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
      className="my-10 text-base leading-relaxed"
    >
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-7">
        <h2 className="text-xl font-semibold">Проверьте понимание</h2>
        <div className="mt-3">{prompt}</div>
        <div
          className="mt-5 space-y-2"
          role="group"
          aria-label="Выберите ответ"
        >
          {options.map((option, index) => (
            <div
              key={option.id}
              className="relative flex min-h-12 w-full gap-3 rounded-xl border border-border px-4 py-3 text-left"
            >
              <button
                ref={index === 0 ? firstChoice : undefined}
                type="button"
                aria-pressed={answer === option.id}
                aria-labelledby={`${quizId}-number-${String(index)} ${quizId}-option-${String(index)}`}
                onClick={() => {
                  choose(option.id);
                }}
                className="absolute inset-0 rounded-xl hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-secondary"
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
            </div>
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
        {answer === null ? null : (
          <>
            <div
              className="mt-5 rounded-xl bg-secondary p-4"
              data-quiz-feedback
            >
              <p
                className="font-semibold"
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
                  <p className="mt-2 font-semibold">Правильный ответ:</p>
                  <div className="mt-2">{correct?.content}</div>
                  <div className="mt-2">{correct?.explanation}</div>
                  <div className="mt-2">{dontKnow.explanation}</div>
                  {review}
                </>
              ) : (
                <>
                  <p className="mt-2 font-semibold">Ваш ответ:</p>
                  <div className="mt-2">{selected.content}</div>
                  <div className="mt-2">{selected.explanation}</div>
                </>
              )}
            </div>
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
          </>
        )}
        {all ? (
          <div className="mt-5 space-y-4 border-t border-border pt-4">
            <h3 className="font-semibold">Разбор всех вариантов</h3>
            {options.map((option, index) => (
              <div key={option.id}>
                <div className="flex gap-3 font-semibold">
                  <span>{index + 1}.</span>
                  <div className="min-w-0">{option.content}</div>
                </div>
                <div className="mt-1">{option.explanation}</div>
              </div>
            ))}
            <p className="font-semibold">Не знаю.</p>
            <div>{dontKnow.explanation}</div>
            {review}
          </div>
        ) : null}
      </div>
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
