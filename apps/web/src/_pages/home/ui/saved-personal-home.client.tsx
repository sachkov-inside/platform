"use client";
import { useQuery } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import { SavedReadingAction } from "@/features/reading-progress";
import { loadPersonalHome } from "../api/personal-home.browser";
import { personalHomeQueryKey } from "../model/personal-home-contract";
import { ContinueLearning } from "./continue-learning";

export function SavedPersonalHome({ initialAccountId }: { readonly initialAccountId: string | null }) {
  const reading = useMaterialReading();
  const accountId = reading.resolved ? reading.accountId : reading.accountId ?? initialAccountId;
  const query = useQuery({ queryKey: personalHomeQueryKey(accountId), queryFn: loadPersonalHome, enabled: reading.resolved && accountId !== null, staleTime: 0, retry: false });
  if (accountId === null) return null;
  const view = query.data ?? { kind: "unavailable" };
  const actions = new Map(view.kind === "ready" ? view.items.filter((item) => item.resume.kind === "reached-end").map((item) => [item.id, <SavedReadingAction key={item.id} materialId={item.id} format={item.format} />]) : []);
  return <ContinueLearning view={view} readingActions={actions} onRetry={() => { void query.refetch(); }} />;
}
