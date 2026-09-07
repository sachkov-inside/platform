"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import { SavedReadingAction } from "@/features/reading-progress";
import { loadPersonalHome } from "../api/personal-home.browser";
import { personalHomeQueryKey } from "../model/personal-home-contract";
import { ContinueLearning } from "./continue-learning";

export function SavedPersonalHome({ initialAccountId }: { readonly initialAccountId: string | null }) {
  const reading = useMaterialReading();
  const accountId = reading.resolved ? reading.accountId : reading.accountId ?? initialAccountId;
  if (accountId === null) return null;
  return <SavedAccountHome key={accountId} accountId={accountId} resolved={reading.resolved} />;
}

function SavedAccountHome({ accountId, resolved }: { readonly accountId: string; readonly resolved: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const query = useQuery({ queryKey: personalHomeQueryKey(accountId), queryFn: loadPersonalHome, enabled: resolved, staleTime: 0, retry: false });
  const view = query.data ?? { kind: "unavailable" };
  useEffect(() => {
    const element = container.current;
    if (element === null || view.kind !== "ready") return;
    const observer = new ResizeObserver(() => { setHeight(element.getBoundingClientRect().height); });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [view.kind]);
  const actions = new Map(view.kind === "ready" ? view.items.filter((item) => item.resume.kind === "reached-end").map((item) => [item.id, <SavedReadingAction key={item.id} materialId={item.id} format={item.format} />]) : []);
  return <div className="flow-root" ref={container} style={view.kind === "unavailable" && height !== undefined ? { minHeight: height } : undefined}><ContinueLearning view={view} readingActions={actions} onRetry={() => { void query.refetch(); }} /></div>;
}
