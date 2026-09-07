"use client";
import { useQuery } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import { getSeriesProgress } from "../api/reading.browser";
import { SeriesProgress } from "./series-progress";
export function SavedSeriesProgress({ seriesId }: { readonly seriesId: string }) {
  const { accountId, resolved } = useMaterialReading();
  if (!resolved || accountId === null) return null;
  return <AccountSeriesProgress accountId={accountId} seriesId={seriesId} />;
}
function AccountSeriesProgress({ accountId, seriesId }: { readonly accountId: string; readonly seriesId: string }) {
  const query = useQuery({ queryKey: ["reading-progress", accountId, "series", seriesId], staleTime: 0, retry: false, queryFn: async () => {
    const result = await getSeriesProgress(seriesId);
    if (result.kind !== "ready") throw new Error(result.kind);
    return result;
  } });
  return <SeriesProgress view={query.data ?? { kind: query.isError ? "unavailable" : "loading" }} />;
}
