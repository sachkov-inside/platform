/**
 * Метка бесплатного урока в читалке (решение владельца 29.10.2026, #1647). В строке программы
 * бесплатный урок отмечен словом без плашки в столбце доступа (решение владельца 29.10.2026, #1837).
 */
export function FreeMaterialBadge() {
  return (
    <span
      className="inline-flex shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold leading-4 text-secondary-foreground"
      data-material-free
    >
      Бесплатно
    </span>
  );
}
