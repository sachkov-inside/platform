"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, use, useEffect, type ReactNode } from "react";

import { useMaterialReading } from "@/entities/material";
import {
  loadSeriesContinuation,
  seriesContinuationQueryKey,
} from "@/features/reading-progress";

export type SeriesLearningView =
  | { readonly kind: "guest" }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "ready";
      readonly read: number;
      readonly total: number;
      readonly continuation: {
        readonly materialSlug: string;
        readonly label: string;
      } | null;
    };

/**
 * Прогресс читателя по программе. Программу рисует сервер, а прогресс личный и живёт в браузере,
 * поэтому шапка и список узнают его отсюда.
 */
const SeriesLearningContext = createContext<SeriesLearningView>({
  kind: "guest",
});

export function SeriesLearningProvider({
  children,
  learning,
}: {
  readonly children: ReactNode;
  readonly learning: SeriesLearningView;
}) {
  return (
    <SeriesLearningContext value={learning}>{children}</SeriesLearningContext>
  );
}

export function useSeriesLearning(): SeriesLearningView {
  return use(SeriesLearningContext);
}

/**
 * Была ли у программы строка приглашения, когда этот читатель видел её в этой вкладке в прошлый раз.
 * По этой памяти общая часть держит или не держит под неё место, и повторный заход шапку не двигает.
 * Память живёт в браузере: на сервере в неё никто не пишет.
 */
const rememberedPurchaseRow = new Map<string, boolean>();
const purchaseRowKey = (accountId: string | null, slug: string) =>
  `${accountId ?? "guest"}:${slug}`;

/**
 * Прогресс программы для вошедшего читателя и память о строке приглашения. Прогресс принадлежит
 * программе: страница продукта его не спрашивает и без входа полноценна.
 */
export function SeriesLearningSource({
  children,
  initialAccountId,
  purchaseRowShown,
  slug,
}: {
  readonly children: ReactNode;
  readonly initialAccountId: string | null;
  readonly purchaseRowShown: boolean;
  readonly slug: string;
}) {
  const reading = useMaterialReading();
  const accountId = reading.resolved
    ? reading.accountId
    : (reading.accountId ?? initialAccountId);
  useEffect(() => {
    rememberedPurchaseRow.set(
      purchaseRowKey(accountId, slug),
      purchaseRowShown,
    );
  }, [accountId, purchaseRowShown, slug]);
  return accountId === null ? (
    <SeriesLearningProvider learning={{ kind: "guest" }}>
      {children}
    </SeriesLearningProvider>
  ) : (
    <AccountSeriesLearning
      key={accountId}
      accountId={accountId}
      resolved={reading.resolved}
      slug={slug}
    >
      {children}
    </AccountSeriesLearning>
  );
}

function AccountSeriesLearning({
  accountId,
  children,
  resolved,
  slug,
}: {
  readonly accountId: string;
  readonly children: ReactNode;
  readonly resolved: boolean;
  readonly slug: string;
}) {
  const query = useQuery({
    queryKey: seriesContinuationQueryKey(accountId, slug),
    queryFn: () => loadSeriesContinuation(slug),
    enabled: resolved,
    retry: false,
  });
  const view = query.isError ? { kind: "unavailable" as const } : query.data;
  const learning: SeriesLearningView =
    view?.kind === "ready"
      ? view
      : view?.kind === "hidden"
        ? { kind: "guest" }
        : view?.kind === "unavailable"
          ? { kind: "unavailable" }
          : { kind: "loading" };
  return (
    <SeriesLearningProvider learning={learning}>
      {children}
    </SeriesLearningProvider>
  );
}

/**
 * Программа на общих данных, пока личная часть идёт (ADR 0027). Вошёл ли человек, браузер уже
 * знает, поэтому место под прогресс занято заранее и шапка не растёт, когда он приходит.
 */
export function PendingSeriesLearning({
  children,
}: {
  readonly children: ReactNode;
}) {
  const reading = useMaterialReading();
  return (
    <SeriesLearningProvider
      learning={
        reading.accountId === null ? { kind: "guest" } : { kind: "loading" }
      }
    >
      {children}
    </SeriesLearningProvider>
  );
}

/**
 * Место под приглашение к оплате, пока личная часть идёт. Держится по памяти прошлого захода; на
 * первом заходе гостю с закрытыми уроками оно нужно, а вошедшему, скорее всего, нет — у него
 * продукт чаще уже открыт. Общая часть прочитана глазами гостя, поэтому замки в ней — гостевые.
 */
export function PendingPurchaseRow({
  lockedForGuest,
  slug,
}: {
  readonly lockedForGuest: boolean;
  readonly slug: string;
}) {
  const reading = useMaterialReading();
  const expected =
    rememberedPurchaseRow.get(purchaseRowKey(reading.accountId, slug)) ??
    (reading.accountId === null && lockedForGuest);
  return expected ? (
    <div
      className="mt-4 flex min-h-11 justify-end"
      data-programme-purchase-row
    />
  ) : null;
}

/** Прогресс в шапке программы: у гостя его нет, у вошедшего место занято и пока он грузится. */
export function ProgrammeProgress() {
  const learning = useSeriesLearning();
  if (learning.kind === "guest") return null;
  return (
    <div className="mt-4 min-h-12 border-t border-border pt-3">
      {learning.kind === "ready" && learning.total > 0 ? (
        <>
          <div className="mb-2 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
            <span>
              Изучено {learning.read} из {learning.total}
            </span>
            <span>{Math.round((100 * learning.read) / learning.total)}%</span>
          </div>
          <progress
            aria-label="Прогресс продукта"
            className="block h-1.5 w-full overflow-hidden rounded-full accent-primary"
            max={learning.total}
            value={learning.read}
          />
        </>
      ) : learning.kind === "loading" ? (
        <p className="text-xs text-muted-foreground" role="status">
          Загружаем прогресс…
        </p>
      ) : learning.kind === "unavailable" ? (
        <p className="text-xs text-muted-foreground">
          Прогресс сейчас не загрузился. Материалы можно читать.
        </p>
      ) : null}
    </div>
  );
}
