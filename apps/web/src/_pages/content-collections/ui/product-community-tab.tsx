import { CourseActivationRulesPanel } from "@/features/course-activation-rules";
import { ProductCommunitySettings } from "@/features/product-community-settings";

/**
 * Вкладка «Сообщество и активация»: общая группа Telegram продукта (только для чтения) и правила
 * активации прежнего курса через бота для этого продукта. Это факты доступа, а не содержания,
 * поэтому вкладка одинаково работает и у продукта, перенесённого из источника.
 */
export function ProductCommunityTab({
  productId,
  productName,
}: {
  readonly productId: string;
  readonly productName: string;
}) {
  return (
    <div className="grid gap-8">
      <ProductCommunitySettings productId={productId} />
      <CourseActivationRulesPanel
        productId={productId}
        productName={productName}
      />
    </div>
  );
}
