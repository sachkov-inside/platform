"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";

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
  /** «за 30 дней». */
  readonly period: string;
  readonly change: MetricChange;
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
  selected = false,
  onSelect,
}: MetricCardProps) {
  const content = (
    <>
      <span className="admin-metric-label">{label}</span>
      <span className="admin-metric-value">{value}</span>
      <span className="admin-metric-footer">
        <MetricChangeLabel change={change} />
        <span className="admin-metric-period">{period}</span>
      </span>
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
