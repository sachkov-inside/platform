/** Шкала и подписи графика по дням: чистые расчёты без React, их проверяют модульные тесты. */

const xLabelSlots = 7;

/** Индексы подписей оси дней: первый, последний и равномерно между ними, без поворота текста. */
export function xLabelIndices(count: number): readonly number[] {
  if (count <= 0) return [];
  if (count <= xLabelSlots) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (xLabelSlots - 1);
  return Array.from({ length: xLabelSlots }, (_, slot) =>
    Math.round(slot * step),
  );
}

/**
 * Шкала графика: верх — ближайшее «круглое» число не меньше максимума. Средняя линия ставится,
 * только если она не дробная для целых данных: «2,5 продажи» на оси не нужны. Отрицательный день
 * (например, выручка дня, где были только возвраты) опускает низ шкалы до «круглого» числа ниже
 * минимума, и нулевая линия остаётся на оси.
 */
export function niceScale(
  max: number,
  integers: boolean,
  min = 0,
): {
  readonly min: number;
  readonly max: number;
  readonly ticks: readonly number[];
} {
  if (min < 0) {
    const bottom = -niceCeil(-min, integers);
    if (max <= 0) return { min: bottom, max: 0, ticks: [bottom, 0] };
    const top = niceCeil(max, integers);
    return { min: bottom, max: top, ticks: [bottom, 0, top] };
  }
  const top = niceCeil(max <= 0 ? 1 : max, integers);
  const half = top / 2;
  return {
    min: 0,
    max: top,
    ticks: !integers || Number.isInteger(half) ? [0, half, top] : [0, top],
  };
}

function niceCeil(value: number, integers: boolean): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (integers && !Number.isInteger(candidate)) continue;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}
