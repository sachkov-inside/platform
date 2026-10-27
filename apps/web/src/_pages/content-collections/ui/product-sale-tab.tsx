import { ProductSalePanel } from "@/features/product-sale-settings";

/**
 * Вкладка «Продажа»: цена, состояние продажи и открытие или закрытие продаж продукта. Под ними
 * место для ссылок на оплату этого продукта (`paymentLinks` у `ProductSalePanel`): список ссылок
 * приходит отдельным модулем и встаёт сюда с уже заданным продуктом.
 */
export function ProductSaleTab({
  productId,
  productName,
  archived,
}: {
  readonly productId: string;
  readonly productName: string;
  readonly archived: boolean;
}) {
  return (
    <ProductSalePanel
      archived={archived}
      productId={productId}
      productName={productName}
    />
  );
}
