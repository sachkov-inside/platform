"use client";
import { useQuery } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import type { PriceSnapshot } from "@/entities/subscription";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { loadSeriesContinuation, seriesContinuationQueryKey } from "@/features/reading-progress";
import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { LibraryDiscoveryView } from "./library-discovery-view";
interface Props {
  readonly result: Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;
  readonly initialAccountId: string | null;
  readonly returnTarget?: MaterialReaderReturnTarget;
  /** Разовая цена руководства, когда владелец её завёл. */
  readonly guideOffer?: PriceSnapshot | null;
}
export function SavedSeries(props: Props) {
  const reading = useMaterialReading();
  const accountId = reading.resolved ? reading.accountId : reading.accountId ?? props.initialAccountId;
  return accountId === null ? <LibraryDiscoveryView result={props.result} learning={{ kind: "guest" }} guideOffer={props.guideOffer ?? null} {...(props.returnTarget === undefined ? {} : { returnTarget: props.returnTarget })} /> : <AccountSeries key={accountId} {...props} accountId={accountId} resolved={reading.resolved} />;
}
function AccountSeries({ result, accountId, resolved, returnTarget, guideOffer = null }: Props & { readonly accountId: string; readonly resolved: boolean }) {
  const query = useQuery({ queryKey: seriesContinuationQueryKey(accountId, result.reference.slug), queryFn: () => loadSeriesContinuation(result.reference.slug), enabled: resolved, staleTime: 0, retry: false });
  const view = query.isError ? { kind: "unavailable" as const } : query.data;
  return <LibraryDiscoveryView result={result} guideOffer={guideOffer} {...(returnTarget === undefined ? {} : { returnTarget })} learning={view?.kind === "ready" ? view : view?.kind === "hidden" ? { kind: "guest" } : view?.kind === "unavailable" ? { kind: "unavailable" } : { kind: "loading" }} onRetry={() => { void query.refetch(); }} />;
}
