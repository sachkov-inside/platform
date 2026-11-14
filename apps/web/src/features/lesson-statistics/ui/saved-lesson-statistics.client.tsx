"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { readLessonStatisticsOperation } from "../api/lesson-statistics.operation";
import {
  documentExercises,
  lessonStatisticsView,
} from "../model/lesson-statistics-view";
import {
  LessonStatisticsPanel,
  type LessonStatisticsState,
} from "./lesson-statistics-panel";

/**
 * Statistics of the lesson open in the editor. Exercises are numbered and labelled by the edited
 * document, so an unsaved change shows at once; the counts come from the backend.
 */
export function SavedLessonStatistics({
  materialId,
  document,
}: {
  readonly materialId: string;
  readonly document: unknown;
}) {
  const query = useQuery({
    queryKey: ["lesson-statistics", materialId],
    queryFn: () => readLessonStatisticsOperation.send({ materialId }),
    // Author-only data is not kept after the tab closes, so another account never sees it.
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const exercises = useMemo(() => documentExercises(document), [document]);
  let state: LessonStatisticsState;
  if (query.isPending) state = { kind: "loading" };
  else if (query.data?.kind === "ready")
    state = {
      kind: "ready",
      exercises: lessonStatisticsView(exercises, query.data.exercises),
      ratings: query.data.ratings,
    };
  else if (query.data?.kind === "forbidden") state = { kind: "forbidden" };
  else state = { kind: "unavailable" };
  return <LessonStatisticsPanel state={state} />;
}
