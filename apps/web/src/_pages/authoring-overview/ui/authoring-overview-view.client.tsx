"use client";

import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import {
  OriginBreakdown,
  OverviewEventList,
  PeriodSwitch,
  formatCount,
  metricChange,
  metricChartSummary,
  metricValueText,
  overviewMetricIds,
  overviewMetrics,
  periodHasFacts,
  periodLabel,
  progressText,
  type OverviewMetricId,
  type OverviewPeriod,
} from "@/features/admin-overview";
import { formatCountRu, formatMoscowDate } from "@/shared/lib/moscow-format";
import {
  AdminErrorState,
  AdminListHeader,
  AdminTable,
  MetricCard,
  TrendChart,
  type AdminTableColumn,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import type { OverviewQuery } from "../model/overview-query";
import {
  attentionView,
  canOpenPeople,
  fullFunnelHref,
  funnelStepRows,
  productLearnersHref,
  type OverviewAttention,
  type OverviewEvents,
  type OverviewFunnel,
  type OverviewLearning,
  type OverviewReport,
  type OverviewState,
} from "../model/overview-report";
import { AuthoringOverviewFrame } from "./authoring-overview-frame";

export interface AuthoringOverviewViewProps {
  readonly state: OverviewState;
  readonly query: OverviewQuery;
  readonly onQueryChange: (query: OverviewQuery) => void;
  readonly onRetry: () => void;
  /** Читается другой период: прежние данные тускнеют, разметка стоит. */
  readonly refreshing?: boolean;
}

const billingRight = "право управлять доступом и оплатами";

/**
 * Обзор админки (#1719): показатели за период со сравнением, график выбранного показателя,
 * «Требует внимания», последние события, краткая воронка и обучение по продуктам. Каждый блок
 * показан по правам аккаунта: закрытый правом блок называет право, недоступный говорит о сбое.
 */
export function AuthoringOverviewView({
  state,
  query,
  onQueryChange,
  onRetry,
  refreshing = false,
}: AuthoringOverviewViewProps) {
  const headingId = useId();
  if (state.kind !== "ready")
    return <OverviewFailure onRetry={onRetry} state={state} />;
  const period = state.period;
  // Без права на продажи и доступ период ни на что не влияет: переключатель и подпись периода
  // не показываются, а закрытые блоки сводятся в один отказ.
  const salesHidden =
    state.metrics.state === "forbidden" &&
    state.funnel.state === "forbidden" &&
    state.learning.state === "forbidden";
  return (
    <AuthoringOverviewFrame labelledBy={headingId}>
      <div
        aria-busy={refreshing || undefined}
        className="admin-overview"
        data-authoring-overview
        data-refreshing={refreshing || undefined}
      >
        <AdminListHeader
          action={
            salesHidden ? undefined : (
              <PeriodSwitch
                onChange={(days) => {
                  onQueryChange({ ...query, period: days });
                }}
                value={query.period}
              />
            )
          }
          headingId={headingId}
          title="Обзор"
        />
        {salesHidden ? (
          <ForbiddenBlock title="Продажи и доступы">
            Выручку, продажи, новые доступы и аккаунты, записи в ожидание,
            воронку и обучение по продуктам видит аккаунт, у которого есть{" "}
            {billingRight}.
          </ForbiddenBlock>
        ) : state.metrics.state === "forbidden" ? (
          <ForbiddenBlock title="Продажи и доступы">
            Выручку, продажи, новые доступы, аккаунты и записи в ожидание видит
            аккаунт, у которого есть {billingRight}.
          </ForbiddenBlock>
        ) : (
          <MetricsRow
            metrics={state.metrics}
            onSelect={(metric) => {
              onQueryChange({ ...query, metric });
            }}
            period={period}
            selected={query.metric}
          />
        )}
        {salesHidden ? null : (
          <p className="admin-overview-quiet">{periodRangeText(period)}</p>
        )}
        <div className="admin-overview-grid">
          {state.metrics.state === "ready" ? (
            <ChartBlock
              metric={query.metric}
              metrics={state.metrics}
              period={period}
            />
          ) : null}
          <AttentionBlock attention={state.attention} />
          <EventsBlock events={state.events} />
          {salesHidden ? null : (
            <>
              <FunnelBlock funnel={state.funnel} period={period} />
              <LearningBlock learning={state.learning} />
            </>
          )}
        </div>
      </div>
    </AuthoringOverviewFrame>
  );
}

/** «Период с 25 сент. 2026 по 24 окт. 2026 по Москве, сравнение с прошлыми 30 днями». */
function periodRangeText(period: OverviewPeriod): string {
  return `Период с ${formatMoscowDate(period.current.firstDay)} по ${formatMoscowDate(period.current.lastDay)} по Москве, сравнение с прошлыми ${formatCountRu(period.days, ["днём", "днями", "днями"])}.`;
}

type ReadyMetrics = Extract<
  OverviewReport["metrics"],
  { readonly state: "ready" }
>;

function MetricsRow({
  metrics,
  period,
  selected,
  onSelect,
}: {
  readonly metrics: ReadyMetrics;
  readonly period: OverviewPeriod;
  readonly selected: OverviewMetricId;
  readonly onSelect: (metric: OverviewMetricId) => void;
}) {
  const span = periodLabel(period.days);
  const sales = readySales(metrics);
  return (
    <section aria-label="Показатели" className="admin-overview-metrics">
      {overviewMetricIds.map((id) => {
        const metric = metrics[id];
        const common = {
          label: overviewMetrics[id].label,
          period: span,
          selected: selected === id,
          onSelect: () => {
            onSelect(id);
          },
        };
        if (metric.state === "unavailable")
          return (
            <MetricCard
              key={id}
              {...common}
              detail="Не удалось посчитать, источник не ответил"
              unavailable
              value="Недоступно"
            />
          );
        return (
          <MetricCard
            key={id}
            {...common}
            change={metricChange(
              id,
              metric.current,
              metric.previous,
              id === "revenue" ? { sales: sales?.previous } : {},
            )}
            detail={
              "byOrigin" in metric ? (
                <OriginBreakdown byOrigin={metric.byOrigin} />
              ) : undefined
            }
            value={metricValueText(id, metric.current.total)}
          />
        );
      })}
    </section>
  );
}

/** Продажи, по которым решается пустота выручки: продажа с возвратом в тот же день не пустота. */
function readySales(metrics: ReadyMetrics) {
  return metrics.sales.state === "ready" ? metrics.sales : undefined;
}

function ChartBlock({
  metric,
  metrics,
  period,
}: {
  readonly metric: OverviewMetricId;
  readonly metrics: ReadyMetrics;
  readonly period: OverviewPeriod;
}) {
  const definition = overviewMetrics[metric];
  const series = metrics[metric];
  const sales = metric === "revenue" ? readySales(metrics) : undefined;
  return (
    <section
      aria-label={`График: ${definition.label}`}
      className="admin-overview-block"
      data-overview-chart
    >
      {series.state === "unavailable" ? (
        <>
          <div className="admin-overview-block-header">
            <h2>{definition.label}</h2>
          </div>
          <BlockNote title="График недоступен" tone="critical">
            Источник не ответил, поэтому дни этого показателя не показаны.
            Остальные показатели можно выбрать карточками выше.
          </BlockNote>
        </>
      ) : (
        <TrendChart
          emptyDescription={definition.emptyDescription}
          emptyTitle={definition.emptyTitle}
          formatValue={(value) => metricValueText(metric, value)}
          hasFacts={
            periodHasFacts(series.current, { sales: sales?.current }) ||
            periodHasFacts(series.previous, { sales: sales?.previous })
          }
          points={series.current.daily}
          previous={series.previous.daily}
          summary={metricChartSummary(
            metric,
            period.days,
            series.current,
            series.previous,
            { sales: sales?.previous },
          )}
          title={definition.label}
        />
      )}
    </section>
  );
}

function AttentionBlock({
  attention,
}: {
  readonly attention: OverviewAttention;
}) {
  const view = attentionView(attention);
  return (
    <section
      aria-labelledby="overview-attention"
      className="admin-overview-block"
      data-overview-attention
    >
      <div className="admin-overview-block-header">
        <h2 id="overview-attention">Требует внимания</h2>
      </div>
      {view.kind === "forbidden" ? (
        <ForbiddenNote>
          Оплаты, выдачу и Telegram проверяет аккаунт, у которого есть{" "}
          {billingRight}, а сдачи аккаунт с правом управлять материалами.
        </ForbiddenNote>
      ) : view.kind === "all_clear" ? (
        <p className="admin-all-clear" role="status">
          <CircleCheck aria-hidden="true" />
          Всё в порядке
        </p>
      ) : (
        <ul aria-label="Требует внимания" className="admin-attention-list">
          {view.rows.map((row) => (
            <li key={row.id}>
              {row.kind === "count" ? (
                <Link
                  aria-label={`${row.label}: ${row.countText}`}
                  className="admin-attention-row"
                  data-kind="count"
                  href={row.href}
                >
                  <TriangleAlert aria-hidden="true" />
                  <span>{row.label}</span>
                  <span className="admin-attention-count">
                    {formatCount(row.count)}
                    <ChevronRight aria-hidden="true" />
                  </span>
                </Link>
              ) : (
                <p className="admin-attention-row m-0" data-kind="unchecked">
                  <CircleAlert aria-hidden="true" />
                  <span>{row.label}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.kind !== "forbidden" && view.hiddenNote !== null ? (
        <p className="admin-overview-quiet">{view.hiddenNote}</p>
      ) : null}
    </section>
  );
}

function EventsBlock({ events }: { readonly events: OverviewEvents }) {
  const sources = [events.payments, events.access, events.submissions];
  const allForbidden = sources.every((source) => source === "forbidden");
  const failed = (
    [
      ["оплаты", events.payments],
      ["выдачи и отзывы", events.access],
      ["сдачи", events.submissions],
    ] as const
  )
    .filter(([, source]) => source === "unavailable")
    .map(([name]) => name);
  return (
    <section
      aria-labelledby="overview-events"
      className="admin-overview-block"
      data-overview-events
    >
      <div className="admin-overview-block-header">
        <h2 id="overview-events">Последние события</h2>
      </div>
      {allForbidden ? (
        <ForbiddenNote>
          Оплаты и выдачи видит аккаунт, у которого есть {billingRight}, а сдачи
          аккаунт с правом управлять материалами.
        </ForbiddenNote>
      ) : (
        <>
          {failed.length === 0 ? null : (
            <BlockNote title="Лента может быть неполной" tone="critical">
              Не загрузились {failed.join(", ")}.
            </BlockNote>
          )}
          {events.items.length === 0 ? (
            failed.length > 0 ? null : (
              <BlockNote title="Событий пока нет">
                Здесь появятся оплаты, выдачи, отзывы доступа и сдачи.
              </BlockNote>
            )
          ) : (
            <OverviewEventList
              events={events.items}
              label="Последние события"
              peopleLinks={canOpenPeople(events)}
            />
          )}
        </>
      )}
    </section>
  );
}

function FunnelBlock({
  funnel,
  period,
}: {
  readonly funnel: OverviewFunnel;
  readonly period: OverviewPeriod;
}) {
  return (
    <section
      aria-labelledby="overview-funnel"
      className="admin-overview-block"
      data-overview-funnel
    >
      <div className="admin-overview-block-header">
        <h2 id="overview-funnel">Воронка продаж</h2>
        {funnel.state === "ready" && funnel.product !== null ? (
          <Link href={fullFunnelHref(funnel.product.id, period.days)}>
            Полный отчёт
          </Link>
        ) : null}
      </div>
      {funnel.state === "forbidden" ? (
        <ForbiddenNote>
          Воронку видит аккаунт, у которого есть {billingRight}.
        </ForbiddenNote>
      ) : funnel.state === "unavailable" ? (
        <BlockNote title="Воронка не загрузилась" tone="critical">
          Отчёт воронки временно недоступен.
        </BlockNote>
      ) : funnel.product === null ? (
        <BlockNote title="Воронки пока нет">
          Она появится, когда в каталоге будет продукт.
        </BlockNote>
      ) : (
        <>
          <p className="admin-funnel-product">
            {funnel.product.name}, {periodLabel(period.days)}
          </p>
          <ol aria-label="Шаги воронки" className="admin-funnel-steps">
            {funnelStepRows(funnel.steps).map((step) => (
              <li
                className="admin-funnel-step"
                data-counted={step.count !== null}
                key={step.id}
              >
                <span>{step.label}</span>
                <span className="admin-funnel-step-count">
                  {step.count === null
                    ? "не считается"
                    : formatCount(step.count)}
                </span>
                <span aria-hidden="true" className="admin-funnel-bar">
                  <span style={{ width: `${String(step.share * 100)}%` }} />
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

interface LearningRow {
  readonly productId: string;
  readonly name: string;
  readonly holders: number;
  readonly started: number;
  readonly averageProgress: number | null;
}

const learningColumns: readonly AdminTableColumn<LearningRow>[] = [
  { id: "product", header: "Продукт", cell: () => null },
  {
    id: "holders",
    header: "Обладатели",
    align: "end",
    width: "8rem",
    cell: (row) => formatCount(row.holders),
  },
  {
    id: "started",
    header: "Начали",
    align: "end",
    width: "8rem",
    cell: (row) => formatCount(row.started),
  },
  {
    id: "progress",
    header: "Средний прогресс",
    align: "end",
    width: "10rem",
    cell: (row) => progressText(row.averageProgress) ?? "нет данных",
  },
];

function LearningBlock({ learning }: { readonly learning: OverviewLearning }) {
  return (
    <section
      aria-labelledby="overview-learning"
      className="admin-overview-block"
      data-overview-learning
      data-span="all"
    >
      <div className="admin-overview-block-header">
        <h2 id="overview-learning">Обучение</h2>
      </div>
      {learning.state === "forbidden" ? (
        <ForbiddenNote>
          Обладателей и прогресс по продуктам видит аккаунт, у которого есть{" "}
          {billingRight}.
        </ForbiddenNote>
      ) : learning.state === "unavailable" ? (
        <BlockNote title="Обучение не загрузилось" tone="critical">
          Обладатели и прогресс временно недоступны.
        </BlockNote>
      ) : learning.products.length === 0 ? (
        <BlockNote title="Продуктов пока нет">
          Здесь появятся обладатели, начавшие обучение и средний прогресс по
          каждому продукту.
        </BlockNote>
      ) : (
        <AdminTable
          caption="Обучение по продуктам"
          columns={learningColumns}
          mobileItem={(row) => ({
            title: row.name,
            caption: `${formatCountRu(row.holders, ["обладатель", "обладателя", "обладателей"])}, начали ${formatCount(row.started)}`,
            metric: progressText(row.averageProgress) ?? "нет данных",
          })}
          rowHref={(row) => productLearnersHref(row.productId)}
          rowKey={(row) => row.productId}
          rowTitle={(row) => row.name}
          rows={learning.products}
        />
      )}
    </section>
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

function ForbiddenNote({ children }: { readonly children: ReactNode }) {
  return (
    <p className="admin-overview-note" data-overview-forbidden>
      <strong>Нет доступа</strong>
      <span>{children}</span>
    </p>
  );
}

function ForbiddenBlock({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="admin-overview-block">
      <div className="admin-overview-block-header">
        <h2>{title}</h2>
      </div>
      <ForbiddenNote>{children}</ForbiddenNote>
    </section>
  );
}

function OverviewFailure({
  state,
  onRetry,
}: {
  readonly state: Exclude<OverviewState, { readonly kind: "ready" }>;
  readonly onRetry: () => void;
}) {
  const headingId = "authoring-overview-title";
  const view =
    state.kind === "signed_out"
      ? {
          title: "Нужен вход",
          description: "Войдите под аккаунтом автора, чтобы увидеть Обзор.",
        }
      : state.kind === "forbidden"
        ? {
            title: "Нет доступа к Обзору",
            description: `Обзор открыт аккаунту, у которого есть ${billingRight} или право управлять материалами.`,
          }
        : {
            title: "Не удалось открыть Обзор",
            description: "Обзор временно недоступен. Повторите чтение.",
          };
  return (
    <AuthoringOverviewFrame labelledBy={headingId}>
      <AdminListHeader headingId={headingId} title="Обзор" />
      <AdminErrorState
        description={view.description}
        title={view.title}
        {...(state.kind === "unavailable"
          ? { reference: state.reference, onRetry }
          : {})}
        {...(state.kind === "signed_out"
          ? {
              retry: (
                <form action="/auth/sign-in" method="post">
                  <Button className="min-h-11 px-4" type="submit">
                    Войти через Telegram
                  </Button>
                </form>
              ),
            }
          : {})}
      />
    </AuthoringOverviewFrame>
  );
}
