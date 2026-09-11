"use client";
import { useQuery } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import type { PriceSnapshot } from "@/entities/subscription";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { loadSeriesContinuation, seriesContinuationQueryKey } from "@/features/reading-progress";
import { GuideProgrammeView } from "./guide-programme-view.client";

interface Props {
  readonly artifacts: ReaderGuideArtifactsResult;
  readonly result: Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;
  readonly initialAccountId: string | null;
  /** Разовая цена руководства, когда владелец её завёл. */
  readonly guideOffer?: PriceSnapshot | null;
  readonly subscriptionOffered?: boolean;
}

/** Прогресс принадлежит программе: страница продукта его не спрашивает и без входа полноценна. */
export function SavedSeries(props: Props) {
  const reading = useMaterialReading();
  const accountId = reading.resolved ? reading.accountId : reading.accountId ?? props.initialAccountId;
  return accountId === null
    ? <GuideProgrammeView artifacts={props.artifacts} guideOffer={props.guideOffer ?? null} learning={{ kind: "guest" }} result={props.result} subscriptionOffered={props.subscriptionOffered ?? false} />
    : <AccountSeries key={accountId} {...props} accountId={accountId} resolved={reading.resolved} />;
}

function AccountSeries({ artifacts, result, accountId, resolved, guideOffer = null, subscriptionOffered = false }: Props & { readonly accountId: string; readonly resolved: boolean }) {
  const query = useQuery({ queryKey: seriesContinuationQueryKey(accountId, result.reference.slug), queryFn: () => loadSeriesContinuation(result.reference.slug), enabled: resolved, staleTime: 0, retry: false });
  const view = query.isError ? { kind: "unavailable" as const } : query.data;
  return <GuideProgrammeView
    artifacts={artifacts}
    guideOffer={guideOffer}
    subscriptionOffered={subscriptionOffered}
    learning={view?.kind === "ready" ? view : view?.kind === "hidden" ? { kind: "guest" } : view?.kind === "unavailable" ? { kind: "unavailable" } : { kind: "loading" }}
    result={result}
  />;
}
