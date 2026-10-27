import { AdminEmptyState } from "@/shared/ui/admin";

/**
 * Вкладка «Ученики» страницы продукта. Пока это место для таблицы обладателей и выдачи продукта
 * нескольким людям (#1718): страница уже показывает вкладку, а её содержимое приходит отдельно и
 * заменяет тело этого компонента, не меняя страницу.
 */
export function ProductLearnersTab({
  productId,
}: {
  readonly productId: string;
}) {
  return (
    <div data-product-learners={productId}>
      <AdminEmptyState
        description="Здесь появятся люди с доступом к продукту, их прогресс и выдача продукта."
        title="Ученики пока не показаны"
      />
    </div>
  );
}
