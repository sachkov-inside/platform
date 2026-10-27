import { ProductOverviewTab as OverviewTab } from "@/features/admin-overview";
import { internalRoute } from "@/shared/routing/internal-route";

/**
 * Вкладка «Обзор» страницы продукта (#1719). Отказ автору только материалов ведет на «Программу»
 * этого же продукта.
 */
export function ProductOverviewTab({
  productId,
}: {
  readonly productId: string;
}) {
  return (
    <OverviewTab
      productId={productId}
      programHref={internalRoute(
        `/authoring/products/${productId}?tab=program`,
      )}
    />
  );
}
