"use client";
import { useState } from "react";
import { fieldClass } from "./parts-editor.client";
const units = [
  { label: "Секунды", seconds: 1 },
  { label: "Минуты", seconds: 60 },
  { label: "Часы", seconds: 3600 },
  { label: "Дни", seconds: 86400 },
];
export function FunnelDelay({
  value,
  onChange,
  name,
}: {
  value: number;
  onChange: (value: number) => void;
  name: string;
}) {
  const [unit, setUnit] = useState(
    () =>
      [...units]
        .reverse()
        .find((item) => value > 0 && value % item.seconds === 0)?.seconds ?? 1,
  );
  return (
    <div className="grid max-w-md grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
      <label className="min-w-0 text-sm font-medium">
        Задержка после предыдущего шага
        <input
          className={fieldClass}
          name={name}
          type="number"
          min={0}
          max={2147483647 / unit}
          step="any"
          required
          value={Number.isFinite(value) ? value / unit : ""}
          onChange={(event) => {
            onChange(
              event.target.value === ""
                ? NaN
                : Math.round(event.target.valueAsNumber * unit),
            );
          }}
        />
      </label>
      <label className="min-w-0 text-sm font-medium">
        Единица времени
        <select
          className={fieldClass}
          value={unit}
          onChange={(event) => {
            setUnit(Number(event.target.value));
          }}
        >
          {units.map((item) => (
            <option key={item.seconds} value={item.seconds}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
