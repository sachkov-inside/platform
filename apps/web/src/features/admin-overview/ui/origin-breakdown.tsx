import { originBreakdown } from "../model/metric-presentation";
import type { OverviewByOrigin } from "../model/overview-contract";

const countFormat = new Intl.NumberFormat("ru-RU");

/**
 * Разбивка по способу получения доступа под значением карточки: только способы, которые были.
 * Карточка бывает кнопкой, поэтому разметка строчная.
 */
export function OriginBreakdown({
  byOrigin,
}: {
  readonly byOrigin: OverviewByOrigin;
}) {
  const parts = originBreakdown(byOrigin);
  if (parts.length === 0) return null;
  return (
    <>
      {parts.map((part) => (
        <span key={part.origin}>
          {part.label}: {countFormat.format(part.count)}
        </span>
      ))}
    </>
  );
}
