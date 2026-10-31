import Link from "next/link";
import { legalDocumentPath } from "@/shared/routing/public-page-path";
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
      <Link
        className="inline-flex min-h-11 items-center text-sm text-action underline underline-offset-4"
        href={legalDocumentPath("purchase")}
      >
        Все условия покупки в оферте
      </Link>
    </section>
  );
}
