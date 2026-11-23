import type { SaleDiscount } from "../model/sale-discount";

import "./sale-discount-badge.css";

/**
 * Наклейка «Скидка 25 % до 30 ноября» на углу анимации курса (решение владельца 23.11.2026).
 * Она в том же виде, что «+ менторинг» и «до старта N дней»: акцентная, повёрнута и чуть парит.
 * Рамке нужен `position: relative` и видимое переполнение: наклейка выходит за верхний край.
 */
export function SaleDiscountBadge({
  discount,
}: {
  readonly discount: SaleDiscount;
}) {
  return (
    <span className="sale-discount-badge">
      <span className="sale-discount-badge-dot" aria-hidden="true" />
      Скидка {discount.amount}
      {discount.until === null ? null : ` ${discount.until}`}
    </span>
  );
}
