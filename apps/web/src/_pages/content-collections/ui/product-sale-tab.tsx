import { PaymentLinksPanel } from "@/features/payment-links";
import { ProductSalePanel } from "@/features/product-sale-settings";

/**
 * Вкладка «Продажа»: цена, состояние продажи и открытие или закрытие продаж продукта, под ними
 * ссылки на оплату этого продукта. Запись цены сбрасывает каталог цен и списки ссылок, поэтому
 * блок ссылок сразу видит новую ревизию цены.
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
      paymentLinks={<PaymentLinksPanel productId={productId} />}
      productId={productId}
      productName={productName}
    />
  );
}
