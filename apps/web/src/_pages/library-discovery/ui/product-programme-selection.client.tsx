"use client";

import { createContext, use, useState, type ReactNode } from "react";

type ProgrammePart = "onboarding" | "programme" | "supplementary";
type Selection = readonly [ProgrammePart | null, (part: ProgrammePart) => void];
const ProgrammeSelection = createContext<Selection | null>(null);

/** The route owns explicit choices above the shared/personal Suspense replacement (#1896). */
export function ProductProgrammeSelectionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const selection = useState<ProgrammePart | null>(null);
  return <ProgrammeSelection value={selection}>{children}</ProgrammeSelection>;
}

export function useProductProgrammeSelection(): Selection {
  // Isolated programme presentations keep their own selection when there is no route owner.
  const local = useState<ProgrammePart | null>(null);
  return use(ProgrammeSelection) ?? local;
}
