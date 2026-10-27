"use client";

import {
  overviewPeriodDays,
  type OverviewPeriodDays,
} from "../model/overview-contract";

import "./admin-overview.css";

const labels: Readonly<Record<OverviewPeriodDays, string>> = {
  7: "7 дней",
  30: "30 дней",
  90: "90 дней",
};

/**
 * Период Обзора: 7, 30 или 90 дней. Выбор хранит адрес страницы; модуль только показывает его и
 * сообщает о новом выборе. Без `onChange` это место переключателя в скелете загрузки: та же
 * геометрия, кнопки недоступны и ничего не выбрано.
 */
export function PeriodSwitch({
  value,
  onChange,
  label = "Период",
}: {
  readonly value?: OverviewPeriodDays;
  readonly onChange?: (period: OverviewPeriodDays) => void;
  readonly label?: string;
}) {
  return (
    <div aria-label={label} className="admin-period-switch" role="group">
      {overviewPeriodDays.map((days) => (
        <button
          aria-pressed={days === value}
          disabled={onChange === undefined}
          key={days}
          onClick={() => {
            if (days !== value) onChange?.(days);
          }}
          type="button"
        >
          {labels[days]}
        </button>
      ))}
    </div>
  );
}
