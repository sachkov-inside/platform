import type { PreorderPrice } from "../model/preorder";

import "./preorder-price.css";

/**
 * Цена предзаказа крупно, рядом зачёркнутая цена после старта и подпись срока. Без цены после
 * старта остаётся одна цена: сравнивать не с чем.
 */
export function PreorderPriceView({
  price,
  note = `до старта ${price.startsOn}`,
  tone = "light",
}: {
  readonly price: PreorderPrice;
  /** Подпись под ценой; по умолчанию — день старта. */
  readonly note?: string | undefined;
  /** На тёмной плашке подписи светлее. */
  readonly tone?: "light" | "dark";
}) {
  return (
    <div className="preorder-price" data-tone={tone}>
      <p className="preorder-price-line">
        <span className="preorder-price-now">{price.price}</span>
        {price.priceAfterStart === null ? null : (
          <>
            {" "}
            <s className="preorder-price-after">
              <span className="sr-only">Цена после старта: </span>
              {price.priceAfterStart}
            </s>
          </>
        )}
      </p>
      <p className="preorder-price-note">{note}</p>
    </div>
  );
}
