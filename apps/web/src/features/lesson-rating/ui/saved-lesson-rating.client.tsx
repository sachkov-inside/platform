"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMaterialReading } from "@/entities/material";

import {
  lessonRatingQueryOptions,
  setLessonRating,
} from "../api/lesson-rating.browser";
import type { LessonRatingValue } from "../model/lesson-rating-contract";
import { LessonRating, type LessonRatingState } from "./lesson-rating.client";

/**
 * «Как вам урок?» с оценкой читателя. Аккаунт посетителя разрешает оболочка урока; гость не
 * спрашивает оценку и не получает отказ 401 в консоли.
 */
export function SavedLessonRating({
  materialId,
}: {
  readonly materialId: string;
}) {
  const { accountId, resolved } = useMaterialReading();
  const queryClient = useQueryClient();
  const options = lessonRatingQueryOptions({
    accountId: resolved ? accountId : null,
    materialId,
  });
  const query = useQuery(options);
  const mutation = useMutation({
    mutationKey: ["lesson-rating", accountId, materialId, "set"],
    mutationFn: (rating: LessonRatingValue | null) =>
      setLessonRating({ materialId, rating }),
    onSuccess: (result) => {
      if (result.kind === "ready")
        queryClient.setQueryData(options.queryKey, result);
    },
  });

  let state: LessonRatingState;
  if (!resolved || (accountId !== null && query.isPending))
    state = { kind: "loading" };
  else if (accountId === null || query.data?.kind === "unauthorized")
    state = { kind: "guest", loginHref: "/account" };
  else if (query.data?.kind !== "ready") state = { kind: "unavailable" };
  else
    state = {
      kind: "ready",
      rating: query.data.rating,
      saving: mutation.isPending,
      failed:
        mutation.isError ||
        (mutation.isSuccess && mutation.data.kind !== "ready"),
    };
  return (
    <LessonRating
      state={state}
      onRate={(rating) => {
        mutation.mutate(rating);
      }}
    />
  );
}
