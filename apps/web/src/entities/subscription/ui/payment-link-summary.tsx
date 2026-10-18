import {
  oneTimePriceShares,
  oneTimePurchaseTerms,
} from "@inside/legal/purchase-terms";
import type { PriceSnapshot } from "../model/billing-contract";
import { oneTimeOfferTerms } from "../model/offer-terms";
import { formatKopecks, formatTermMonths } from "../model/presentation";

export function PaymentLinkSummary({
  snapshot,
  title,
  headingLevel = 3,
}: {
  readonly snapshot: PriceSnapshot;
  readonly title: string;
  readonly headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const terms = oneTimeOfferTerms(snapshot);
  const term = (months: number | null) =>
    months === null ? "без ограничения срока" : formatTermMonths(months);
  const shares = oneTimePriceShares(snapshot.firstPriceKopecks);
  const base =
    snapshot.individualPayment?.basePriceKopecks ??
    snapshot.paymentOption.priceKopecks;
  return (
    <section
      className="min-w-0 border-t border-border pt-6"
      aria-label="Условия покупки"
    >
      <Heading className="mb-4 break-words text-xl font-semibold">
        {title}
      </Heading>
      <p className="text-[2rem] font-semibold tabular-nums">
        {formatKopecks(snapshot.firstPriceKopecks)}
      </p>
      {base > snapshot.firstPriceKopecks && (
        <p className="mt-1 text-sm text-muted-foreground">
          Обычная цена <s>{formatKopecks(base)}</s>
        </p>
      )}
      <ul className="my-6 list-disc space-y-2 pl-5 text-sm leading-6">
        <li>Материалы {term(terms.materialsMonths)}</li>
        {terms.chatMonths !== undefined && (
          <li>Чат продукта {term(terms.chatMonths)}</li>
        )}
      </ul>
      <details className="text-sm leading-6">
        <summary className="min-h-11 cursor-pointer py-3 font-semibold">
          Все условия покупки
        </summary>
        <div className="space-y-3 py-3">
          <p>
            {terms.supportMonths === undefined
              ? "Сопровождение не входит."
              : `Сопровождение автора — ${term(terms.supportMonths)}.`}{" "}
            {terms.chatMonths === undefined
              ? "Чат продукта не входит."
              : "Окончание сопровождения не сокращает срок материалов и чата."}
          </p>
          <p>
            {terms.supportMonths === undefined
              ? `Вся цена ${formatKopecks(snapshot.firstPriceKopecks)} относится к материалам${terms.chatMonths === undefined ? "" : " и чату"}.`
              : `Материалы${terms.chatMonths === undefined ? "" : " и чат"} — ${formatKopecks(shares.materialsAndChatKopecks)}. Сопровождение — ${formatKopecks(shares.supportKopecks)}.`}
          </p>
          <p>
            Сроки начинаются после подтверждения оплаты. Расчётный срок для
            возврата за бессрочный доступ —{" "}
            {oneTimePurchaseTerms.unlimitedPartRefundMonths} месяцев. Он не
            ограничивает срок доступа.
          </p>
        </div>
      </details>
    </section>
  );
}
