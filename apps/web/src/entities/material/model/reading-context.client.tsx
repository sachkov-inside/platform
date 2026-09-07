"use client";
import { createContext, useContext, useEffect } from "react";
export interface MaterialReadingSnapshot { readonly isRead: boolean; readonly version: number }
export interface MaterialReadingContextValue {
  readonly accountId: string | null;
  readonly resolved: boolean;
  readonly states: ReadonlyMap<string, MaterialReadingSnapshot>;
  readonly failed: boolean;
  readonly register: (materialId: string) => () => void;
  readonly refresh: () => Promise<void>;
}
export const MaterialReadingContext = createContext<MaterialReadingContextValue>({ accountId: null, resolved: false, states: new Map(), failed: false, register: () => () => undefined, refresh: () => Promise.resolve() });
export function useMaterialReading(materialId?: string) {
  const context = useContext(MaterialReadingContext);
  const { register } = context;
  useEffect(() => materialId === undefined ? undefined : register(materialId), [register, materialId]);
  return { ...context, state: materialId === undefined ? undefined : context.states.get(materialId) };
}
