"use client";

import { useMutation } from "@tanstack/react-query";
import { CircleCheck, Save } from "lucide-react";
import { useId, useState } from "react";

import { formatSubmissionMoment } from "@/entities/guide-task";
import { Button } from "@/shared/ui/button";

import { saveAuthorFeedback } from "../api/save-author-feedback.browser";
import {
  AUTHOR_COMMENT_MAX_CHARACTERS,
  type SaveAuthorFeedbackResult,
} from "../model/author-feedback";
import type { AuthorFeedback } from "../model/task-submissions";

const failures: Record<
  Exclude<SaveAuthorFeedbackResult["kind"], "saved">,
  string
> = {
  invalid_input: `Отзыв не принят. Комментарий — до ${String(AUTHOR_COMMENT_MAX_CHARACTERS)} символов; если он короче, обнови страницу.`,
  forbidden: "Отзыв оставляет автор с правом materials:manage.",
  submission_not_found: "Сдача не найдена. Обнови страницу.",
  unauthorized: "Сессия закончилась. Войди снова, текст останется в форме.",
  unavailable: "Не удалось сохранить. Попробуй ещё раз.",
};

/**
 * The author's answer to one submission (#948): an optional comment and the «посмотрел автор» mark.
 * The learner sees both on the task page and through `learning_task_submissions`. The saved answer
 * replaces the form state, so the time of the mark is the one the server stored.
 */
export function AuthorFeedbackForm({
  feedback,
  submissionId,
}: {
  readonly feedback: AuthorFeedback | null;
  readonly submissionId: string;
}) {
  const id = useId();
  const [saved, setSaved] = useState(feedback);
  const [comment, setComment] = useState(feedback?.comment ?? "");
  const [reviewed, setReviewed] = useState(
    feedback !== null && feedback.reviewedAt !== null,
  );
  const mutation = useMutation({
    mutationFn: () => saveAuthorFeedback({ submissionId, comment, reviewed }),
    onSuccess: (result) => {
      if (result.kind !== "saved") return;
      setSaved(result.authorFeedback);
      setComment(result.authorFeedback?.comment ?? "");
      setReviewed(
        result.authorFeedback !== null &&
          result.authorFeedback.reviewedAt !== null,
      );
    },
  });
  const result = mutation.data;
  const changed =
    comment.trim() !== (saved?.comment ?? "") ||
    reviewed !== (saved !== null && saved.reviewedAt !== null);
  return (
    <form
      className="grid gap-3"
      data-author-feedback-form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <label
        className="flex min-h-11 items-center gap-3 text-sm font-medium"
        htmlFor={`${id}-reviewed`}
      >
        <input
          checked={reviewed}
          className="size-5 accent-[var(--accent)]"
          id={`${id}-reviewed`}
          name="reviewed"
          onChange={(event) => {
            setReviewed(event.target.checked);
          }}
          type="checkbox"
        />
        Посмотрел автор
      </label>
      <label
        className="grid gap-1.5 text-sm font-medium"
        htmlFor={`${id}-comment`}
      >
        <span>
          Комментарий для ученика{" "}
          <span className="font-normal text-muted-foreground">
            — необязательно
          </span>
        </span>
        <textarea
          className="min-h-24 rounded-lg border border-input bg-card px-3 py-2 font-normal leading-6"
          id={`${id}-comment`}
          maxLength={AUTHOR_COMMENT_MAX_CHARACTERS}
          name="comment"
          onChange={(event) => {
            setComment(event.target.value);
          }}
          value={comment}
        />
      </label>
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          className="min-h-11"
          disabled={!changed || mutation.isPending}
          type="submit"
          variant="outline"
        >
          <Save aria-hidden="true" />
          {mutation.isPending ? "Сохраняем…" : "Сохранить отзыв"}
        </Button>
        <p className="min-w-0 text-sm leading-6" role="status">
          {result?.kind === "saved" && !changed ? (
            <span className="inline-flex items-center gap-1.5 text-[color:var(--callout-good)]">
              <CircleCheck aria-hidden="true" className="size-4" />
              Сохранено. Ученик увидит отзыв на странице задания.
            </span>
          ) : saved?.reviewedAt === null || saved === null ? null : (
            <span className="text-muted-foreground">
              Отмечено{" "}
              <time dateTime={saved.reviewedAt}>
                {formatSubmissionMoment(saved.reviewedAt)}
              </time>
            </span>
          )}
        </p>
      </div>
      {result === undefined || result.kind === "saved" ? null : (
        <p className="text-sm leading-6 text-destructive" role="alert">
          {failures[result.kind]}
        </p>
      )}
    </form>
  );
}
