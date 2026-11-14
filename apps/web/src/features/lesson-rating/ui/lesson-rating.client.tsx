"use client";

import type { Route } from "next";
import Link from "next/link";
import { ThumbsDown, ThumbsUp } from "lucide-react";

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
 * «Как вам урок?» в конце урока (#2124): одна строка на подложке и две круглые кнопки, лайк и
 * дизлайк вошедшего. Оценку можно изменить или снять повторным нажатием.
 */
export function LessonRating({ state, onRate }: LessonRatingProps) {
  if (state.kind === "loading") return null;
  return (
    <section
      aria-labelledby="lesson-rating-heading"
      className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-lesson-line bg-lesson-surface py-2 pr-2 pl-4 sm:pl-6"
      data-lesson-rating
    >
      <div className="min-w-0 flex-1 py-2">
        <h2 className="font-semibold" id="lesson-rating-heading">
          Как вам урок?
        </h2>
        {state.kind === "guest" ? (
          <p className="text-sm text-muted-foreground">
            <Link
              className="text-foreground underline underline-offset-4"
              href={state.loginHref}
            >
              Войдите
            </Link>
            , чтобы оценить урок.
          </p>
        ) : state.kind === "unavailable" ? (
          <p className="text-sm text-muted-foreground" role="status">
            Оценка сейчас недоступна.
          </p>
        ) : (
          <p
            className="text-xs text-muted-foreground empty:hidden"
            role="status"
          >
            {state.failed
              ? "Не удалось сохранить оценку. Попробуйте ещё раз."
              : state.rating === null
                ? ""
                : "Спасибо за оценку. Повторное нажатие снимает её."}
          </p>
        )}
      </div>
      {state.kind === "ready" ? (
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
                    : "border border-lesson-line bg-card text-foreground hover:bg-muted",
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
      ) : null}
    </section>
  );
}
