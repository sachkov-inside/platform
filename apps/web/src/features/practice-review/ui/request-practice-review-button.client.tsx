"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { internalRoute } from "@/shared/routing/internal-route";

import { requestPracticeReview } from "../api/practice-review.browser";
import { reviewRefusalMessages } from "../model/practice-review";

/** Адрес Assistant Conversation практики. */
export function practiceConversationPath(practiceId: string): string {
  return `/account/course-assistant/practices/${encodeURIComponent(practiceId)}`;
}

/**
 * «Проверить задание» у практики в reader (#788): ставит проверку и открывает чат этой
 * практики, где участник видит ход и итог.
 */
export function RequestPracticeReviewButton({
  practiceId,
  contextVersion,
}: {
  readonly practiceId: string;
  readonly contextVersion: string;
}) {
  const router = useRouter();
  const request = useMutation({
    mutationFn: () =>
      requestPracticeReview({
        practiceId,
        expectedContextVersion: contextVersion,
      }),
    retry: false,
    onSuccess: (result) => {
      if (result.ok)
        router.push(internalRoute(practiceConversationPath(practiceId)));
    },
  });
  const refused =
    request.data !== undefined && !request.data.ok ? request.data.code : null;
  return (
    <div className="mt-3">
      <button
        className="min-h-11 rounded-lg bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-60"
        disabled={request.isPending}
        onClick={() => {
          request.mutate();
        }}
        type="button"
      >
        Проверить задание
      </button>
      {refused === null ? null : (
        <p className="mt-2 text-sm" role="alert">
          {refused === "unauthorized"
            ? "Войдите, чтобы проверить задание."
            : reviewRefusalMessages[refused]}
        </p>
      )}
    </div>
  );
}
