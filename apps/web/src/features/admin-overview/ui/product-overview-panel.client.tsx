"use client";

import { CircleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { formatCountRu } from "@/shared/lib/moscow-format";
import { AdminErrorState, MetricCard } from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import {
  formatCount,
  metricChange,
  metricValueText,
  periodLabel,
  progressText,
} from "../model/metric-presentation";
import type {
  OverviewMetric,
  OverviewPeriodDays,
} from "../model/overview-contract";
import type { ProductOverviewState } from "../model/product-overview";
import { OriginBreakdown } from "./origin-breakdown";
import { OverviewEventList } from "./overview-event-list";
import { PeriodSwitch } from "./period-switch.client";

import "./admin-overview.css";

/** Пока первое чтение идет, у вкладки нет состояния: она показывает свою загрузку. */
export type ProductOverviewViewState =
  ProductOverviewState | { readonly kind: "loading" };

export interface ProductOverviewPanelProps {
  readonly state: ProductOverviewViewState;
  readonly period: OverviewPeriodDays;
  readonly onPeriodChange: (period: OverviewPeriodDays) => void;
  readonly onRetry: () => void;
  /** Вкладка «Программа» этого продукта: туда ведет отказ автору только материалов. */
  readonly programHref: Route;
  /** Повторное чтение за другой период: блоки тускнеют, разметка стоит. */
  readonly refreshing?: boolean;
}

const unavailableValue = "Недоступно";
const unavailableDetail = "Источник не ответил";

/**
 * Вкладка «Обзор» страницы продукта: обладатели по способу получения, выручка и продажи за период
 * со сравнением, список ожидания текущего набора, обучение и последние события продукта. Отказ в
 * праве показан отказом со ссылкой на «Программу», а не пустыми цифрами.
 */
export function ProductOverviewPanel({
  state,
  period,
  onPeriodChange,
  onRetry,
  programHref,
  refreshing = false,
}: ProductOverviewPanelProps) {
  const headingId = useId();
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="m-0 text-lg font-semibold" id={headingId}>
        Обзор продукта
      </h2>
      {state.kind === "ready" || state.kind === "loading" ? (
        <PeriodSwitch
          label="Период обзора продукта"
          onChange={onPeriodChange}
          value={period}
        />
      ) : null}
    </div>
  );

  if (state.kind === "loading")
    return (
      <section
        aria-busy="true"
        aria-labelledby={headingId}
        className="admin-overview"
      >
        {header}
        <p className="admin-overview-quiet" role="status">
          Загружаем обзор продукта…
        </p>
      </section>
    );

  if (state.kind !== "ready")
    return (
      <section aria-labelledby={headingId} className="admin-overview">
        {header}
        <ProductOverviewFailure
          onRetry={onRetry}
          programHref={programHref}
          state={state}
        />
      </section>
    );

  const span = periodLabel(state.period.days);
  return (
    <section
      aria-busy={refreshing || undefined}
      data-refreshing={refreshing || undefined}
      aria-labelledby={headingId}
      className="admin-overview"
      data-product-overview
    >
      {header}
      <div className="admin-overview-metrics" data-columns="4">
        <MetricCard
          label="Обладатели"
          value={
            state.holders.state === "ready"
              ? formatCount(state.holders.active)
              : unavailableValue
          }
          detail={
            state.holders.state === "ready" ? (
              state.holders.active === 0 ? (
                "Доступа пока ни у кого нет"
              ) : (
                <OriginBreakdown byOrigin={state.holders.byOrigin} />
              )
            ) : (
              unavailableDetail
            )
          }
          period="сейчас"
        />
        <PeriodMetric
          label="Выручка за вычетом возвратов"
          metric={state.revenue}
          moneyLike
          span={span}
        />
        <PeriodMetric label="Продажи" metric={state.sales} span={span} />
        <MetricCard
          label="Список ожидания"
          value={
            state.waitlist.state === "unavailable"
              ? unavailableValue
              : state.waitlist.intake === null
                ? "Нет набора"
                : formatCount(state.waitlist.intake.active)
          }
          detail={
            state.waitlist.state === "unavailable"
              ? unavailableDetail
              : state.waitlist.intake === null
                ? "Набор не открыт: записи появятся, когда он откроется"
                : `Набор «${state.waitlist.intake.name}»`
          }
        />
      </div>
      <div className="admin-overview-grid">
        <section
          aria-label="Обучение"
          className="admin-overview-block"
          data-span="all"
        >
          <div className="admin-overview-block-header">
            <h3 className="m-0 text-[15px] font-semibold">Обучение</h3>
          </div>
          {state.learning.state === "unavailable" ? (
            <BlockNote tone="critical" title="Обучение не загрузилось">
              Начало обучения и прогресс временно недоступны.
            </BlockNote>
          ) : (
            <LearningSummary
              averageProgress={state.learning.averageProgress}
              holders={state.learning.holders}
              started={state.learning.started}
            />
          )}
        </section>
        <section
          aria-label="Последние события продукта"
          className="admin-overview-block"
          data-span="all"
        >
          <div className="admin-overview-block-header">
            <h3 className="m-0 text-[15px] font-semibold">Последние события</h3>
          </div>
          {state.events.state === "unavailable" ? (
            <BlockNote tone="critical" title="События не загрузились">
              Оплаты и выдачи продукта временно недоступны.
            </BlockNote>
          ) : state.events.items.length === 0 ? (
            <BlockNote title="Событий пока нет">
              Здесь появятся оплаты, выдачи, отзывы и восстановления доступа.
            </BlockNote>
          ) : (
            <OverviewEventList
              events={state.events.items}
              label="Последние события продукта"
              peopleLinks
            />
          )}
        </section>
      </div>
    </section>
  );
}

function PeriodMetric({
  label,
  metric,
  span,
  moneyLike = false,
}: {
  readonly label: string;
  readonly metric: OverviewMetric;
  readonly span: string;
  readonly moneyLike?: boolean;
}) {
  const id = moneyLike ? "revenue" : "sales";
  if (metric.state === "unavailable")
    return (
      <MetricCard
        detail={unavailableDetail}
        label={label}
        period={span}
        value={unavailableValue}
      />
    );
  return (
    <MetricCard
      change={metricChange(id, metric.current, metric.previous)}
      label={label}
      period={span}
      value={metricValueText(id, metric.current.total)}
    />
  );
}

function LearningSummary({
  holders,
  started,
  averageProgress,
}: {
  readonly holders: number;
  readonly started: number;
  readonly averageProgress: number | null;
}) {
  const progress = progressText(averageProgress);
  return (
    <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
      <div className="grid gap-0.5">
        <dt className="text-muted-foreground">Начали обучение</dt>
        <dd className="m-0 text-xl font-semibold tabular-nums">
          {formatCountRu(started, ["человек", "человека", "человек"])}
        </dd>
        <dd className="m-0 text-xs text-muted-foreground">
          из{" "}
          {formatCountRu(holders, ["обладателя", "обладателей", "обладателей"])}
        </dd>
      </div>
      <div className="grid gap-0.5">
        <dt className="text-muted-foreground">Средний прогресс</dt>
        <dd className="m-0 text-xl font-semibold tabular-nums">
          {progress ?? "Нет данных"}
        </dd>
        {progress === null ? (
          <dd className="m-0 text-xs text-muted-foreground">
            Никто ещё не начал
          </dd>
        ) : null}
      </div>
    </dl>
  );
}

function BlockNote({
  title,
  children,
  tone,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly tone?: "critical";
}) {
  return (
    <p className="admin-overview-note" data-tone={tone}>
      <strong>
        {tone === "critical" ? <CircleAlert aria-hidden="true" /> : null}
        {title}
      </strong>
      <span>{children}</span>
    </p>
  );
}

function ProductOverviewFailure({
  state,
  onRetry,
  programHref,
}: {
  readonly state: Exclude<ProductOverviewState, { readonly kind: "ready" }>;
  readonly onRetry: () => void;
  readonly programHref: Route;
}) {
  switch (state.kind) {
    case "forbidden":
      return (
        <section className="admin-state">
          <h2>Обзор продукта закрыт</h2>
          <p>
            Выручку, обладателей и события продукта видит аккаунт с правом
            управлять доступом и оплатами. Программа продукта открыта вам
            полностью.
          </p>
          <div className="admin-state-actions">
            <Button asChild className="min-h-11 px-4" variant="outline">
              <Link href={programHref}>Открыть программу</Link>
            </Button>
          </div>
        </section>
      );
    case "not_found":
      return (
        <AdminErrorState
          description="Продукт не найден: его удалили или адрес устарел."
          title="Обзор продукта недоступен"
        />
      );
    case "signed_out":
      return (
        <AdminErrorState
          description="Сессия закончилась. Войдите снова, чтобы увидеть обзор продукта."
          retry={
            <form action="/auth/sign-in" method="post">
              <Button className="min-h-11 px-4" type="submit">
                Войти через Telegram
              </Button>
            </form>
          }
          title="Нужен вход"
        />
      );
    case "unavailable":
      return (
        <AdminErrorState
          description="Обзор продукта временно недоступен. Повторите чтение."
          onRetry={onRetry}
          reference={state.reference}
          title="Не удалось открыть обзор"
        />
      );
  }
}
