"use client";
import { useQuery } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import { loadPersonalHome } from "../api/personal-home.browser";
import { personalHomeQueryKey } from "../model/personal-home-contract";
import type { HomeResult } from "../model/home-view";
import { HomePage } from "./home-page";

export function SavedPersonalHome({ initialAccountId, result }: { readonly initialAccountId: string | null; readonly result: HomeResult }) {
  const reading = useMaterialReading();
  const accountId = reading.resolved ? reading.accountId : reading.accountId ?? initialAccountId;
  return accountId === null ? <HomePage result={result} /> : <SavedAccountHome key={accountId} accountId={accountId} resolved={reading.resolved} result={result} />;
}
function SavedAccountHome({ accountId, resolved, result }: { readonly accountId: string; readonly resolved: boolean; readonly result: HomeResult }) {
  const query = useQuery({ queryKey: personalHomeQueryKey(accountId), queryFn: loadPersonalHome, enabled: resolved, staleTime: 0, retry: false });
  // Сорвавшееся обновление важнее прежнего ответа: показывать продолжение, которого мы уже не
  // подтверждаем, значит звать человека туда, где его может не быть. Публичная главная при этом
  // остаётся на месте. Так же поступает программа руководства.
  const view = query.isError ? { kind: "unavailable" as const } : query.data;
  return <div data-personal-home-state={view?.kind ?? "loading"}><HomePage result={result} {...(view?.kind === "ready" ? { continuation: view.continuation } : {})} /></div>;
}
