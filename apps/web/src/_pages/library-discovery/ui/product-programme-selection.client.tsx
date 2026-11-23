"use client";

import { createContext, use, useState, type ReactNode } from "react";

type ProgrammePart = "onboarding" | "programme" | "supplementary";
type Selection = readonly [ProgrammePart | null, (part: ProgrammePart) => void];

/** The chapter window the reader chose, for the programme address it was chosen on. */
export interface ChapterWindowChoice {
  readonly source: string;
  readonly id: string | null;
}
type ChapterChoice = readonly [
  ChapterWindowChoice | null,
  (choice: ChapterWindowChoice) => void,
];

const ProgrammeSelection = createContext<Selection | null>(null);
const ChapterWindowSelection = createContext<ChapterChoice | null>(null);

/**
 * The route owns explicit choices above the shared/personal Suspense replacement (#1896): the
 * chosen part and the open chapter window survive when the personal programme replaces the shared one.
 */
export function ProductProgrammeSelectionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const selection = useState<ProgrammePart | null>(null);
  const chapter = useState<ChapterWindowChoice | null>(null);
  return (
    <ProgrammeSelection value={selection}>
      <ChapterWindowSelection value={chapter}>
        {children}
      </ChapterWindowSelection>
    </ProgrammeSelection>
  );
}

export function useProductProgrammeSelection(): Selection {
  // Isolated programme presentations keep their own selection when there is no route owner.
  const local = useState<ProgrammePart | null>(null);
  return use(ProgrammeSelection) ?? local;
}

export function useProductChapterWindowChoice(): ChapterChoice {
  const local = useState<ChapterWindowChoice | null>(null);
  return use(ChapterWindowSelection) ?? local;
}
