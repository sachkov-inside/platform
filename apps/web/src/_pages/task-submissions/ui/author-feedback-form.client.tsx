"use client";

import { useMutation } from "@tanstack/react-query";
import { CircleCheck, Save } from "lucide-react";
import { useId } from "react";

import { formatSubmissionMoment } from "@/entities/product-task";
import { Button } from "@/shared/ui/button";

import { saveAuthorFeedback } from "../api/save-author-feedback.browser";
import {
  AUTHOR_COMMENT_MAX_CHARACTERS,
  type SaveAuthorFeedbackResult,
  type SaveAuthorFeedbackInput,
} from "../model/author-feedback";
import type { AuthorFeedback } from "../model/task-submissions";
import { feedbackChanged } from "../model/feedback-draft";
import { useFeedbackDraft } from "./task-submissions-runtime.client";

const failures: Record<
  Exclude<SaveAuthorFeedbackResult["kind"], "saved">,
  string
> = {
  invalid_input: `Отзыв не принят. Комментарий — до ${String(AUTHOR_COMMENT_MAX_CHARACTERS)} символов; если он короче, обнови страницу.`,
  forbidden: "Отзыв оставляет автор с правом materials:manage.",
  submission_not_found: "Сдача не найдена. Обнови страницу.",
  unauthorized:
    "Сессия закончилась. Войди на сайт в другой вкладке и повтори сохранение. Черновик здесь сохранён.",
  unavailable: "Не удалось сохранить. Попробуй ещё раз.",
};

/**
 * The author's optional comment on one submission (#1351).
 * The learner reads it on the task page and through `learning_task_submissions`.
 * Previously stored «посмотрел автор» marks survive edits; this form cannot add a mark.
 */
export function AuthorFeedbackForm({
  feedback,
  submissionId,
}: {
  readonly feedback: AuthorFeedback | null;
  readonly submissionId: string;
}) {
  const id = useId();
  const { draft, update } = useFeedbackDraft(submissionId, feedback);
  const { saved, comment, reviewed, result } = draft;
  const mutation = useMutation({
    mutationFn: (input: SaveAuthorFeedbackInput) => saveAuthorFeedback(input),
    onSuccess: (outcome) => {
      update((current) =>
        outcome.kind === "saved"
          ? {
              ...current,
              saved: outcome.authorFeedback,
              clearedLocally: outcome.authorFeedback === null,
              comment: outcome.authorFeedback?.comment ?? "",
              reviewed:
                outcome.authorFeedback !== null &&
                outcome.authorFeedback.reviewedAt !== null,
              pending: false,
              result: outcome,
            }
          : { ...current, pending: false, result: outcome },
      );
    },
    onError: () => {
      update((current) => ({
        ...current,
        pending: false,
        result: { kind: "unavailable" },
      }));
    },
  });
  const changed = feedbackChanged(draft);
  return (
    <form
      aria-label="Комментарий автора"
      className="grid w-full gap-4"
      data-author-feedback-form
      onSubmit={(event) => {
        event.preventDefault();
        if (!changed || draft.pending) return;
        update((current) => ({ ...current, pending: true, result: null }));
        mutation.mutate({ submissionId, comment, reviewed });
      }}
    >
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
          disabled={draft.pending}
          maxLength={AUTHOR_COMMENT_MAX_CHARACTERS}
          name="comment"
          rows={3}
          placeholder="Напишите, если хотите помочь ученику"
          onChange={(event) => {
            const value = event.target.value;
            update((current) => ({ ...current, comment: value, result: null }));
          }}
          value={comment}
        />
      </label>
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          className="min-h-11"
          disabled={!changed || draft.pending}
          type="submit"
          variant="default"
        >
          <Save aria-hidden="true" />
          {draft.pending ? "Сохраняем…" : "Сохранить комментарий"}
        </Button>
        <p className="min-w-0 text-sm leading-6" role="status">
          {result?.kind === "saved" && !changed ? (
            <span className="inline-flex items-center gap-1.5 text-[color:var(--callout-good)]">
              <CircleCheck aria-hidden="true" className="size-4" />
              Сохранено. Ученик увидит комментарий на странице задания.
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
      {result === null || result.kind === "saved" ? null : (
        <p className="text-sm leading-6 text-destructive" role="alert">
          {failures[result.kind]}
        </p>
      )}
    </form>
  );
}
