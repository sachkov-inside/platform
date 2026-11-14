"use client";

import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useMaterialReading } from "@/entities/material";
import type { GlossaryTerm } from "@/entities/material.model";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

import { setTermMark, termMarksQueryOptions } from "../api/term-marks.browser";
import type { TermMarkCommand } from "../model/term-mark-contract";
import { termMarkChanges } from "../model/term-mark-events";
import {
  LessonTermDeck,
  type LessonTermDeckMarking,
} from "./lesson-term-deck.client";

/**
 * Колода урока с отметками читателя. Аккаунт посетителя разрешает оболочка урока; гость не
 * спрашивает отметки и не получает отказ 401 в консоли.
 */
export function SavedLessonTermDeck({
  terms,
  courseGlossaryHref,
}: {
  readonly terms: readonly GlossaryTerm[];
  readonly courseGlossaryHref?: Route | undefined;
}) {
  const { accountId, resolved } = useMaterialReading();
  const queryClient = useQueryClient();
  const options = termMarksQueryOptions({
    accountId: resolved ? accountId : null,
    termIds: terms.map((term) => term.id),
  });
  const state = useQuery(options);
  const changes = useMemo(
    () => (resolved && accountId !== null ? termMarkChanges(accountId) : null),
    [accountId, resolved],
  );
  useAnnouncedRefresh(changes, ["glossary-marks", accountId]);
  const mutation = useMutation({
    mutationKey: ["glossary-marks", accountId, "set"],
    mutationFn: (input: TermMarkCommand) => setTermMark(input),
    onSuccess: (result) => {
      if (result.kind !== "ready") return;
      queryClient.setQueryData(options.queryKey, (previous) => ({
        kind: "ready" as const,
        marks: [
          ...(previous?.kind === "ready"
            ? previous.marks.filter(
                (mark) => mark.termId !== result.mark.termId,
              )
            : []),
          result.mark,
        ],
      }));
      changes?.announce();
    },
  });

  if (terms.length === 0) return null;
  let marking: LessonTermDeckMarking;
  if (!resolved || (accountId !== null && state.isPending))
    marking = { kind: "loading" };
  else if (accountId === null || state.data?.kind === "unauthorized")
    marking = { kind: "guest", loginHref: "/account" };
  else if (state.data?.kind !== "ready") marking = { kind: "unavailable" };
  else
    marking = {
      kind: "ready",
      marks: new Map(
        state.data.marks.map((mark) => [mark.termId, mark.mark] as const),
      ),
      savingTermId: mutation.isPending ? mutation.variables.termId : null,
      failed:
        mutation.isError ||
        (mutation.isSuccess && mutation.data.kind !== "ready"),
    };
  return (
    <LessonTermDeck
      courseGlossaryHref={courseGlossaryHref}
      marking={marking}
      onMark={(termId, mark) => {
        mutation.mutate({ termId, mark });
      }}
      terms={terms}
    />
  );
}
