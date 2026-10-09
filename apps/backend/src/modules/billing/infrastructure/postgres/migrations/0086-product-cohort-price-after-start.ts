export const name = "0086_product_cohort_price_after_start";

// Решение владельца 08.10.2026: цена после старта хранится у потока и только показывается
// зачёркнутой рядом с ценой предзаказа. Существующие потоки получают NULL и её не показывают.
export const statement = `
ALTER TABLE billing.product_cohorts
  ADD COLUMN price_after_start_kopecks bigint
    CHECK (price_after_start_kopecks BETWEEN 1 AND 9007199254740991);
`;
