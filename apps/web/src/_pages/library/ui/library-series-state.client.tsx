"use client";

import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

interface SeriesState { readonly q: string; readonly expanded: boolean }
type SeriesController = readonly [SeriesState, Dispatch<SetStateAction<SeriesState>>];
const LibrarySeriesContext = createContext<SeriesController | null>(null);

/** Keeps the Library's geometry across route changes within the public shell. */
export function LibrarySeriesStateProvider({ children }: { readonly children: ReactNode }) {
  const state = useState<SeriesState>({ q: "", expanded: false });
  return <LibrarySeriesContext value={state}>{children}</LibrarySeriesContext>;
}

export function useLibrarySeriesExpansion(q: string) {
  // Standalone presentation stories retain the same interaction without a shell.
  const localState = useState<SeriesState>({ q, expanded: false });
  const [state, setState] = useContext(LibrarySeriesContext) ?? localState;
  const expanded = state.q === q && state.expanded;

  useEffect(() => {
    if (state.q !== q) setState({ q, expanded: false });
  }, [q, setState, state.q]);

  return { expanded, toggle: () => { setState({ q, expanded: !expanded }); } };
}
