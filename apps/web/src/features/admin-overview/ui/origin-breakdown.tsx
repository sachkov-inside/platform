import { formatCount } from "@/shared/lib/moscow-format";

import { originBreakdown } from "../model/metric-presentation";
import type { OverviewByOrigin } from "../model/overview-contract";

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
          {part.label}: {formatCount(part.count)}
        </span>
      ))}
    </>
  );
}
