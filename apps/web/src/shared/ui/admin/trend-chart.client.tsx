"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";

import { formatMoscowShortDay } from "@/shared/lib/moscow-format";

import { niceScale, xLabelIndices } from "./trend-scale";

import "./admin.css";

export interface TrendPoint {
  /** День «YYYY-MM-DD». */
  readonly date: string;
  readonly value: number;
}

export interface TrendChartProps {
  readonly title: string;
  /** Описание данных словами: им график читается без картинки. */
  readonly summary: string;
  readonly points: readonly TrendPoint[];
  /** Прошлый период той же длины; i-й день сравнивается с i-м. */
  readonly previous?: readonly TrendPoint[];
  readonly formatValue: (value: number) => string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  /**
   * За период были факты, хотя каждый день в сумме ноль: например, продажа и её возврат в один
   * день. Тогда график рисует нулевую линию, а не пустое состояние.
   */
  readonly hasFacts?: boolean;
}

/**
 * Линейный график по дням: текущий период сплошной линией, прошлый пунктиром. Своё SVG без
 * библиотек. Линии рисуются в растянутой системе координат 100 × 100, а подписи и отметки рисует HTML
 * поверх по процентам, поэтому график тянется на любую ширину и текст не искажается.
 * Поле графика фокусируется; стрелки, Home и End переводят отметку по дням, а строка под графиком
 * называет день и значения. Рядом лежит скрытая таблица с теми же данными.
 */
export function TrendChart({
  title,
  summary,
  points,
  previous = [],
  formatValue,
  emptyTitle,
  emptyDescription,
  hasFacts = false,
}: TrendChartProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const summaryId = `${id}-summary`;
  const readoutId = `${id}-readout`;
  const [active, setActive] = useState<number | null>(null);

  const comparable = previous.slice(0, points.length);
  const empty =
    points.length === 0 ||
    (!hasFacts &&
      [...points, ...comparable].every((point) => point.value === 0));

  const header = (
    <div className="admin-trend-header">
      <div className="grid gap-0.5">
        <p className="admin-trend-title" id={titleId}>
          {title}
        </p>
        <p className="admin-trend-summary" id={summaryId}>
          {summary}
        </p>
      </div>
      {empty ? null : (
        <ul aria-hidden="true" className="admin-trend-legend">
          <li>
            <LegendSwatch series="current" />
            Текущий период
          </li>
          {comparable.length === 0 ? null : (
            <li>
              <LegendSwatch series="previous" />
              Прошлый период
            </li>
          )}
        </ul>
      )}
    </div>
  );

  if (empty)
    return (
      <figure aria-labelledby={titleId} className="admin-trend">
        {header}
        <div className="admin-trend-empty">
          <p>{emptyTitle}</p>
          <p>{emptyDescription}</p>
        </div>
      </figure>
    );

  const scale = niceScale(
    Math.max(
      ...points.map((point) => point.value),
      ...comparable.map((point) => point.value),
    ),
    [...points, ...comparable].every((point) => Number.isInteger(point.value)),
    Math.min(
      ...points.map((point) => point.value),
      ...comparable.map((point) => point.value),
    ),
  );
  const last = points.length - 1;
  const shown = active ?? last;
  const x = (index: number) => (last === 0 ? 50 : (index / last) * 100);
  const y = (value: number) =>
    100 - ((value - scale.min) / (scale.max - scale.min)) * 100;
  const currentPoint = points[shown];
  const previousPoint = comparable[shown];

  const moveTo = (index: number) => {
    setActive(Math.min(Math.max(index, 0), last));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "ArrowLeft"
        ? shown - 1
        : event.key === "ArrowRight"
          ? shown + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    moveTo(next);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    moveTo(Math.round(((event.clientX - rect.left) / rect.width) * last));
  };

  return (
    <figure aria-labelledby={titleId} className="admin-trend">
      {header}
      <div className="admin-trend-frame">
        <div aria-hidden="true" className="admin-trend-y-axis">
          {scale.ticks.map((tick) => (
            <span key={tick} style={{ top: `${String(y(tick))}%` }}>
              {formatValue(tick)}
            </span>
          ))}
        </div>
        <div
          aria-describedby={`${summaryId} ${readoutId}`}
          aria-label={`${title}. Стрелки влево и вправо выбирают день.`}
          aria-roledescription="график"
          className="admin-trend-plot"
          onBlur={() => {
            setActive(null);
          }}
          onFocus={() => {
            setActive((current) => current ?? last);
          }}
          onKeyDown={onKeyDown}
          onPointerLeave={(event) => {
            if (event.currentTarget !== document.activeElement) setActive(null);
          }}
          onPointerMove={onPointerMove}
          role="group"
          tabIndex={0}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            {scale.ticks.map((tick) => (
              <line
                className="admin-trend-grid"
                key={tick}
                vectorEffect="non-scaling-stroke"
                x1="0"
                x2="100"
                y1={y(tick)}
                y2={y(tick)}
              />
            ))}
            {comparable.length > 1 ? (
              <polyline
                className="admin-trend-previous"
                points={polylinePoints(comparable, x, y)}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {points.length > 1 ? (
              <polyline
                className="admin-trend-current"
                points={polylinePoints(points, x, y)}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          {points.length === 1 && active === null ? (
            <span
              className="admin-trend-dot"
              data-series="single"
              style={{
                left: "50%",
                top: `${String(y(points[0]?.value ?? 0))}%`,
              }}
            />
          ) : null}
          {active === null || currentPoint === undefined ? null : (
            <>
              <span
                className="admin-trend-guide"
                style={{ left: `${String(x(active))}%` }}
              />
              {previousPoint === undefined ? null : (
                <span
                  className="admin-trend-dot"
                  data-series="previous"
                  style={{
                    left: `${String(x(active))}%`,
                    top: `${String(y(previousPoint.value))}%`,
                  }}
                />
              )}
              <span
                className="admin-trend-dot"
                data-series="current"
                style={{
                  left: `${String(x(active))}%`,
                  top: `${String(y(currentPoint.value))}%`,
                }}
              />
            </>
          )}
        </div>
        <div aria-hidden="true" className="admin-trend-x-axis">
          {xLabelIndices(points.length).map((index, slot, all) => {
            const point = points[index];
            if (point === undefined) return null;
            return (
              <span
                data-edge={
                  points.length === 1
                    ? undefined
                    : index === 0
                      ? "start"
                      : index === last
                        ? "end"
                        : undefined
                }
                data-minor={
                  slot % 2 === 1 && slot !== all.length - 1 ? "" : undefined
                }
                key={point.date}
                style={{ left: `${String(x(index))}%` }}
              >
                {formatMoscowShortDay(point.date)}
              </span>
            );
          })}
        </div>
      </div>
      <p aria-live="polite" className="admin-trend-readout" id={readoutId}>
        {currentPoint === undefined
          ? ""
          : readout(currentPoint, previousPoint, formatValue)}
      </p>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">День</th>
            <th scope="col">Текущий период</th>
            {comparable.length === 0 ? null : (
              <th scope="col">Прошлый период</th>
            )}
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => {
            const before = comparable[index];
            return (
              <tr key={point.date}>
                <th scope="row">{formatMoscowShortDay(point.date)}</th>
                <td>{formatValue(point.value)}</td>
                {comparable.length === 0 ? null : (
                  <td>
                    {before === undefined
                      ? "нет данных"
                      : formatValue(before.value)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

function LegendSwatch({ series }: { readonly series: "current" | "previous" }) {
  return (
    <svg aria-hidden="true" height="8" viewBox="0 0 20 8" width="20">
      <line
        className={
          series === "current" ? "admin-trend-current" : "admin-trend-previous"
        }
        x1="1"
        x2="19"
        y1="4"
        y2="4"
      />
    </svg>
  );
}

function readout(
  current: TrendPoint,
  previous: TrendPoint | undefined,
  formatValue: (value: number) => string,
): string {
  const head = `${formatMoscowShortDay(current.date)}: ${formatValue(current.value)}`;
  return previous === undefined
    ? head
    : `${head} (прошлый период: ${formatValue(previous.value)})`;
}

function polylinePoints(
  points: readonly TrendPoint[],
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  return points
    .map((point, index) => `${String(x(index))},${String(y(point.value))}`)
    .join(" ");
}
