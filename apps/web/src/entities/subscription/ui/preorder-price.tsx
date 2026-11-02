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
  struckLabel = "Цена после старта",
}: {
  readonly price: PreorderPrice;
  /** Подпись под ценой; по умолчанию — день старта, `null` — без подписи. */
  readonly note?: string | null | undefined;
  /** На тёмной плашке подписи светлее. */
  readonly tone?: "light" | "dark";
  /** Что значит зачёркнутая цена, для экранного диктора; без потоков это цена без скидки. */
  readonly struckLabel?: string;
}) {
  return (
    <div className="preorder-price" data-tone={tone}>
      <p className="preorder-price-line">
        <span className="preorder-price-now">{price.price}</span>
        {price.priceAfterStart === null ? null : (
          <>
            {" "}
            <s className="preorder-price-after">
              <span className="sr-only">{struckLabel}: </span>
              {price.priceAfterStart}
            </s>
          </>
        )}
      </p>
      {note === null ? null : <p className="preorder-price-note">{note}</p>}
    </div>
  );
}
