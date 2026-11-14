"use client";

import type { Route } from "next";
import Link from "next/link";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useId } from "react";

import { cn } from "@/shared/lib/utils";

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

/**
 * «Как вам урок?» в карточке конца урока (#2124): одна тихая строка и две круглые кнопки, лайк и
 * дизлайк вошедшего. Оценку можно изменить или снять повторным нажатием. Гость видит вместо кнопок
 * короткое предложение войти.
 */
export function LessonRating({ state, onRate }: LessonRatingProps) {
  const labelId = useId();
  if (state.kind === "loading") return null;
  return (
    <div
      aria-labelledby={labelId}
      className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1"
      data-lesson-rating
      role="group"
    >
      <p id={labelId}>Как вам урок?</p>
      {state.kind === "guest" ? (
        <p className="text-sm text-muted-foreground">
          <Link
            className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
            href={state.loginHref}
          >
            Войдите
          </Link>
          , чтобы оценить
        </p>
      ) : state.kind === "unavailable" ? (
        <p className="text-sm text-muted-foreground" role="status">
          Оценка сейчас недоступна.
        </p>
      ) : (
        <div className="flex shrink-0 gap-1">
          {choices.map(({ value, label, Icon }) => {
            const chosen = state.rating === value;
            return (
              <button
                aria-label={label}
                aria-pressed={chosen}
                className={cn(
                  "grid size-11 place-items-center rounded-full transition-colors duration-(--motion-duration-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 motion-reduce:transition-none",
                  chosen
                    ? "bg-lesson-graphite text-lesson-graphite-foreground hover:bg-lesson-graphite-hover"
                    : "text-muted-foreground hover:bg-lesson-stack hover:text-foreground",
                )}
                data-lesson-rating-choice={value}
                disabled={state.saving}
                key={value}
                onClick={() => {
                  onRate?.(chosen ? null : value);
                }}
                title={label}
                type="button"
              >
                <Icon aria-hidden="true" className="size-5" />
              </button>
            );
          })}
        </div>
      )}
      {state.kind === "ready" ? (
        <p
          className={
            state.failed ? "w-full text-xs text-muted-foreground" : "sr-only"
          }
          role="status"
        >
          {state.failed
            ? "Не удалось сохранить оценку. Попробуйте ещё раз."
            : state.rating === null
              ? ""
              : "Спасибо за оценку."}
        </p>
      ) : null}
    </div>
  );
}
