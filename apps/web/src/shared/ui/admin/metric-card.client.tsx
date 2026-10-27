"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { ReactNode } from "react";

import "./admin.css";

export type MetricChange =
  | {
      readonly kind: "delta";
      /** Изменение числом: «+2 продажи», «−1 200 ₽». */
      readonly text: string;
      readonly direction: "up" | "down" | "flat";
      /** Смысл изменения: рост возвратов плох, рост продаж хорош. */
      readonly meaning: "good" | "bad" | "neutral";
    }
  | { readonly kind: "no_data" };

export interface MetricCardProps {
  readonly label: string;
  /** Уже отформатированное значение. */
  readonly value: string;
  /** «за 30 дней»; у состояния на сейчас, например числа обладателей, периода нет. */
  readonly period?: string;
  /** Без сравнения карточка показывает только значение: число на сейчас или недоступный показатель. */
  readonly change?: MetricChange | undefined;
  /**
   * Короткое уточнение под значением, например разбивка по способам получения. Карточка бывает
   * кнопкой, поэтому внутри только строчные элементы (`span`).
   */
  readonly detail?: ReactNode;
  readonly selected?: boolean;
  /** С обработчиком карточка становится переключателем графика (`aria-pressed`). */
  readonly onSelect?: () => void;
}

const meaningText = {
  good: "хорошо",
  bad: "плохо",
  neutral: "без оценки",
} as const;

/**
 * Показатель за период со сравнением с прошлым таким же периодом. Изменение показано числом;
 * цвет следует смыслу и всегда дублируется стрелкой и знаком в тексте.
 */
export function MetricCard({
  label,
  value,
  period,
  change,
  detail,
  selected = false,
  onSelect,
}: MetricCardProps) {
  const content = (
    <>
      <span className="admin-metric-label">{label}</span>
      <span className="admin-metric-value">{value}</span>
      {detail === undefined ? null : (
        <span className="admin-metric-detail">{detail}</span>
      )}
      {change === undefined && period === undefined ? null : (
        <span className="admin-metric-footer">
          {change === undefined ? null : <MetricChangeLabel change={change} />}
          {period === undefined ? null : (
            <span className="admin-metric-period">{period}</span>
          )}
        </span>
      )}
    </>
  );
  if (onSelect === undefined)
    return <div className="admin-metric">{content}</div>;
  return (
    <button
      aria-pressed={selected}
      className="admin-metric"
      onClick={onSelect}
      type="button"
    >
      {content}
    </button>
  );
}

function MetricChangeLabel({ change }: { readonly change: MetricChange }) {
  if (change.kind === "no_data")
    return (
      <span className="admin-metric-change" data-meaning="none">
        нет данных
      </span>
    );
  const Icon =
    change.direction === "up"
      ? ArrowUp
      : change.direction === "down"
        ? ArrowDown
        : Minus;
  return (
    <span className="admin-metric-change" data-meaning={change.meaning}>
      <Icon aria-hidden="true" />
      {change.text}
      <span className="sr-only">({meaningText[change.meaning]})</span>
    </span>
  );
}
