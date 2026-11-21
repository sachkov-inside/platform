"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { useMaterialReading } from "@/entities/material";
import { Button } from "@/shared/ui/button";

import {
  lessonFeedbackTextLimit,
  readLessonFeedbackOperation,
  submitLessonFeedbackOperation,
} from "../api/lesson-feedback.operation";

export function SavedLessonFeedback({
  materialId,
}: {
  readonly materialId: string;
}) {
  const { accountId, resolved } = useMaterialReading();
  if (!resolved || accountId === null) return null;
  return (
    <AccountLessonFeedback
      key={`${accountId}:${materialId}`}
      accountId={accountId}
      materialId={materialId}
    />
  );
}

function AccountLessonFeedback({
  accountId,
  materialId,
}: {
  readonly accountId: string;
  readonly materialId: string;
}) {
  const queryKey = ["lesson-feedback", accountId, materialId] as const;
  const client = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: () => readLessonFeedbackOperation.send({ materialId }),
    retry: false,
  });
  const [text, setText] = useState("");
  const textId = useId();
  const mutation = useMutation({
    mutationFn: (value: string) =>
      submitLessonFeedbackOperation.send({ materialId, text: value }),
    onSuccess: (result) => {
      if (result.kind === "ready" && result.submitted) {
        client.setQueryData(queryKey, result);
        setText("");
      }
    },
  });

  if (query.isPending || query.data?.kind === "unauthorized") return null;
  if (query.data?.kind !== "ready")
    return (
      <p className="py-3 text-sm text-muted-foreground" role="status">
        Отзыв сейчас недоступен.
      </p>
    );

  const submitted = query.data.submitted;
  const failed =
    mutation.isError ||
    (mutation.isSuccess &&
      (mutation.data.kind !== "ready" || !mutation.data.submitted));
  return (
    <div className="py-3">
      {submitted ? null : (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() !== "" && !mutation.isPending)
              mutation.mutate(text);
          }}
        >
          <label className="text-sm font-medium" htmlFor={textId}>
            Отзыв об уроке
          </label>
          <p className="text-sm text-muted-foreground" id={`${textId}-hint`}>
            Что понравилось, чего не хватило? Отзыв получит автор в Telegram.
          </p>
          <textarea
            aria-describedby={`${textId}-hint`}
            className="min-h-24 w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            id={textId}
            maxLength={lessonFeedbackTextLimit}
            onChange={(event) => {
              setText(event.target.value);
            }}
            readOnly={mutation.isPending}
            required
            rows={3}
            value={text}
          />
          <Button
            className="min-h-11 justify-self-start"
            disabled={text.trim() === "" || mutation.isPending}
            type="submit"
            variant="outline"
          >
            {mutation.isPending ? "Отправляем…" : "Отправить отзыв"}
          </Button>
        </form>
      )}
      <p
        className={
          submitted || failed ? "text-sm text-muted-foreground" : "sr-only"
        }
        role="status"
      >
        {submitted
          ? "Спасибо за отзыв."
          : failed
            ? "Не удалось отправить отзыв. Попробуйте ещё раз."
            : ""}
      </p>
    </div>
  );
}
