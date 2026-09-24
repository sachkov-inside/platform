"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useMaterialReading } from "@/entities/material";
import type { PriceSnapshot } from "@/entities/subscription";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { loadSeriesContinuation, seriesContinuationQueryKey } from "@/features/reading-progress";
import { GuideProgrammeView, hasLockedItems, programmePurchase } from "./guide-programme-view.client";

interface Props {
  readonly artifacts: ReaderGuideArtifactsResult;
  readonly result: Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;
  readonly initialAccountId: string | null;
  /** Разовая цена руководства, когда владелец её завёл. */
  readonly guideOffer?: PriceSnapshot | null;
  readonly subscriptionOffered?: boolean;
}

/**
 * Была ли у программы строка приглашения, когда этот читатель видел её в этой вкладке в прошлый раз.
 * По этой памяти общая часть держит или не держит под неё место, и повторный заход шапку не двигает.
 * Память живёт в браузере: на сервере в неё никто не пишет.
 */
const rememberedPurchaseRow = new Map<string, boolean>();
const purchaseRowKey = (accountId: string | null, slug: string) => `${accountId ?? "guest"}:${slug}`;

/** Прогресс принадлежит программе: страница продукта его не спрашивает и без входа полноценна. */
export function SavedSeries(props: Props) {
  const reading = useMaterialReading();
  const accountId = reading.resolved ? reading.accountId : reading.accountId ?? props.initialAccountId;
  const purchaseRowShown = programmePurchase({ guideOffer: props.guideOffer ?? null, result: props.result, subscriptionOffered: props.subscriptionOffered ?? false }) !== null;
  const slug = props.result.reference.slug;
  useEffect(() => {
    rememberedPurchaseRow.set(purchaseRowKey(accountId, slug), purchaseRowShown);
  }, [accountId, purchaseRowShown, slug]);
  return accountId === null
    ? <GuideProgrammeView artifacts={props.artifacts} guideOffer={props.guideOffer ?? null} learning={{ kind: "guest" }} result={props.result} subscriptionOffered={props.subscriptionOffered ?? false} />
    : <AccountSeries key={accountId} {...props} accountId={accountId} resolved={reading.resolved} />;
}

function AccountSeries({ artifacts, result, accountId, resolved, guideOffer = null, subscriptionOffered = false }: Props & { readonly accountId: string; readonly resolved: boolean }) {
  const query = useQuery({ queryKey: seriesContinuationQueryKey(accountId, result.reference.slug), queryFn: () => loadSeriesContinuation(result.reference.slug), enabled: resolved, retry: false });
  const view = query.isError ? { kind: "unavailable" as const } : query.data;
  return <GuideProgrammeView
    artifacts={artifacts}
    guideOffer={guideOffer}
    subscriptionOffered={subscriptionOffered}
    learning={view?.kind === "ready" ? view : view?.kind === "hidden" ? { kind: "guest" } : view?.kind === "unavailable" ? { kind: "unavailable" } : { kind: "loading" }}
    result={result}
  />;
}

/**
 * Программа на общих данных, пока личная часть идёт (ADR 0027). Вошёл ли человек, браузер уже
 * знает, поэтому место под прогресс занято заранее и шапка не растёт, когда он приходит. Место под
 * приглашение к оплате держится по памяти прошлого захода; на первом заходе гостю с закрытыми
 * уроками оно нужно, а вошедшему, скорее всего, нет — у него продукт чаще уже открыт.
 */
export function PendingSeries({ artifacts, result }: Pick<Props, "artifacts" | "result">) {
  const reading = useMaterialReading();
  // Общая часть прочитана глазами гостя, поэтому замки в ней — гостевые.
  const purchaseRowExpected = rememberedPurchaseRow.get(purchaseRowKey(reading.accountId, result.reference.slug)) ?? (reading.accountId === null && hasLockedItems(result));
  return <GuideProgrammeView artifacts={artifacts} learning={reading.accountId === null ? { kind: "guest" } : { kind: "loading" }} pending={{ purchaseRowExpected }} result={result} />;
}
