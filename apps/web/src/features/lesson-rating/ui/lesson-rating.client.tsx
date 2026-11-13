"use client";

import type { Route } from "next";
import Link from "next/link";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import type { LessonRatingValue } from "../model/lesson-rating-contract";

export type LessonRatingState =
  | { readonly kind: "loading" }
  | { readonly kind: "guest"; readonly loginHref: Route }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "ready";
      readonly rating: LessonRatingValue | null;
      readonly saving: boolean;
      readonly failed: boolean;
    };

export interface LessonRatingProps {
  readonly state: LessonRatingState;
  /** `null` снимает оценку: так работает повторное нажатие на выбранную кнопку. */
  readonly onRate?: (rating: LessonRatingValue | null) => void;
}

const choices = [
  { value: "like", label: "Понравился", Icon: ThumbsUp },
  { value: "dislike", label: "Не понравился", Icon: ThumbsDown },
] as const;

/** «Как вам урок?» в конце урока (#2124): лайк или дизлайк вошедшего, который можно изменить или снять. */
export function LessonRating({ state, onRate }: LessonRatingProps) {
  if (state.kind === "loading") return null;
  return (
    <section
      aria-labelledby="lesson-rating-heading"
      className="mt-8 rounded-xl border border-border p-3 text-sm sm:p-4 sm:text-base"
      data-lesson-rating
    >
      <h2 className="font-semibold" id="lesson-rating-heading">
        Как вам урок?
      </h2>
      {state.kind === "guest" ? (
        <p className="mt-2 text-muted-foreground">
          <Link
            className="text-foreground underline underline-offset-4"
            href={state.loginHref}
          >
            Войдите
          </Link>
          , чтобы оценить урок.
        </p>
      ) : state.kind === "unavailable" ? (
        <p className="mt-2 text-muted-foreground" role="status">
          Оценка сейчас недоступна.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {choices.map(({ value, label, Icon }) => {
              const chosen = state.rating === value;
              return (
                <Button
                  aria-pressed={chosen}
                  className={cn(
                    "min-h-11 flex-1 gap-2 px-4 sm:flex-none",
                    chosen && "ring-2 ring-ring/50",
                  )}
                  data-lesson-rating-choice={value}
                  disabled={state.saving}
                  key={value}
                  onClick={() => {
                    onRate?.(chosen ? null : value);
                  }}
                  type="button"
                  variant={chosen ? "default" : "outline"}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </Button>
              );
            })}
          </div>
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            {state.failed
              ? "Не удалось сохранить оценку. Попробуйте ещё раз."
              : state.rating === null
                ? ""
                : "Спасибо за оценку. Повторное нажатие снимает её."}
          </p>
        </>
      )}
    </section>
  );
}
