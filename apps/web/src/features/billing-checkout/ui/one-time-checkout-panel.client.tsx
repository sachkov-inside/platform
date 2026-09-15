"use client";
import { CalendarClock, MessagesSquare, Play } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useId } from "react";

import { LegalDocumentLinks, legalNavigationEntry } from "@/entities/legal-document";
import {
  billingActionClass,
  ConsentChecklist,
  legalDocumentLabel,
  attemptStateLabel,
  formatKopecks,
  paymentMode,
  promotionLabel,
  purchaseConsentPolicy,
  type BillingQuote,
  type LegalDocument,
  type LegalDocumentKind,
  type PriceSnapshot,
  type PurchaseStatus,
  type VerifiedContact,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import {
  oneTimePriceSharesLine,
  oneTimeTermsSummary,
  type CheckoutInclusion,
} from "../model/one-time-terms";

export interface OneTimeCheckoutPanelProps {
  readonly snapshot: PriceSnapshot;
  readonly quote: BillingQuote | null;
  readonly documents: readonly LegalDocument[];
  readonly accepted: readonly LegalDocumentKind[];
  readonly contact: VerifiedContact | null;
  readonly contactHref: Route;
  readonly acknowledgeExistingAccess: boolean;
  readonly existingAccess?: boolean;
  readonly legacyBlocked?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly purchase: PurchaseStatus | null;
  readonly inclusions?: readonly CheckoutInclusion[];
  readonly onToggleDocument: (kind: LegalDocumentKind) => void;
  readonly onToggleAcknowledge: () => void;
  readonly onPay: () => void;
  readonly onRefreshStatus: () => void;
  readonly onRetryQuote: () => void;
}

/**
 * Оплата руководства одной страницей: что входит, сколько стоит, куда придёт чек и одна кнопка.
 * Цена показывается сразу — расчёт сервер сохраняет сам, поэтому отдельного шага «рассчитать»
 * здесь нет. Возврат из банка успехом не считается: состояние приходит от сервера.
 */

/**
 * Название принимаемого документа: оферты покупки и подписки называются по документу. После
 * «Принимаю» оферта стоит в винительном падеже.
 */
function documentLabel(document: LegalDocument): string {
  if (document.documentId === "purchase") return "оферту разовой покупки";
  return legalNavigationEntry(document.documentId)?.navLabel ?? legalDocumentLabel(document.kind);
}

const inclusionIcons = {
  composition: Play,
  materials: CalendarClock,
  support: MessagesSquare,
} as const satisfies Record<CheckoutInclusion["kind"], unknown>;

export function OneTimeCheckoutPanel({
  snapshot,
  quote,
  documents,
  accepted,
  contact,
  contactHref,
  acknowledgeExistingAccess,
  existingAccess = false,
  legacyBlocked = false,
  pending = false,
  error,
  purchase,
  inclusions = [],
  onToggleDocument,
  onToggleAcknowledge,
  onPay,
  onRefreshStatus,
  onRetryQuote,
}: OneTimeCheckoutPanelProps) {
  const headingId = useId();
  const termsId = useId();
  const acknowledgeId = useId();
  const conditions = quote?.snapshot ?? snapshot;
  const promotion = promotionLabel(conditions);
  const { required, applicable } = purchaseConsentPolicy(
    documents,
    paymentMode(conditions),
  );
  const missingRequired = required.filter(
    (kind) => !applicable.some((document) => document.kind === kind),
  );
  const payable =
    quote !== null &&
    contact !== null &&
    missingRequired.length === 0 &&
    required.every((kind) => accepted.includes(kind)) &&
    !legacyBlocked &&
    (!existingAccess || acknowledgeExistingAccess);

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h2 className="sr-only" id={headingId}>
        Оплата продукта
      </h2>

      {inclusions.length === 0 ? null : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {inclusions.map((inclusion) => {
            const Icon = inclusionIcons[inclusion.kind];
            return (
              <li
                className={`grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 rounded-2xl bg-secondary p-4 ${inclusion.kind === "composition" ? "sm:col-span-2" : ""}`}
                key={inclusion.kind}
              >
                <span
                  aria-hidden="true"
                  className="grid size-10 place-items-center rounded-xl bg-background text-foreground"
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    {inclusion.caption}
                  </span>
                  <span className="mt-0.5 block break-words font-semibold leading-6">
                    {inclusion.title}
                  </span>
                  {inclusion.detail === undefined ? null : (
                    <span className="block break-words text-sm leading-5 text-muted-foreground">
                      {inclusion.detail}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 rounded-2xl bg-primary p-5 text-white">
        <p className="font-semibold">Без подписки и доплат</p>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3">
          <span className="text-3xl font-bold tabular-nums tracking-[-0.04em]">
            {formatKopecks(conditions.firstPriceKopecks)}
          </span>
          <span className="text-sm text-white/70">разово</span>
        </p>
        <p className="mt-2 text-sm leading-6 text-white/85">
          {oneTimePriceSharesLine(conditions.firstPriceKopecks)}
        </p>
        {promotion === undefined ? null : (
          <p className="mt-2 font-mono text-xs text-white/70">{promotion}</p>
        )}
        {quote === null ? (
          <p className="mt-3 text-sm leading-6 text-white/70" role="status">
            {pending
              ? "Готовим точные условия…"
              : "Точные условия пока не сохранены."}
          </p>
        ) : null}
      </div>

      {quote === null && !pending ? (
        <Button
          className={`mt-4 ${billingActionClass}`}
          onClick={onRetryQuote}
          type="button"
          variant="outline"
        >
          Обновить условия
        </Button>
      ) : null}

      {contact === null ? (
        <p className="mt-5 rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6" role="status">
          Чек выписывается на подтверждённый адрес, а он пока не подтверждён.{" "}
          <Link className="font-semibold text-action underline underline-offset-4" href={contactHref}>
            Подтвердить его в кабинете
          </Link>
          .
        </p>
      ) : null}

      <section
        aria-labelledby={termsId}
        className="mt-5 rounded-2xl border border-border p-4 text-sm leading-6"
      >
        <h3 className="font-semibold" id={termsId}>
          Условия покупки
        </h3>
        <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-muted-foreground">
          {oneTimeTermsSummary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {missingRequired.length > 0 ? (
        <p
          className="mt-5 rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6"
          role="status"
        >
          Условия продажи ещё не опубликованы, поэтому принять оплату нельзя.
        </p>
      ) : (
        <div className="mt-5">
          <ConsentChecklist
            accepted={accepted}
            disabled={pending}
            documents={applicable}
            labelFor={documentLabel}
            legend="Перед оплатой"
            markOptional
            namePrefix="one-time-consent"
            onToggle={onToggleDocument}
            required={required}
          />
        </div>
      )}

      <LegalDocumentLinks
        className="mt-5"
        label="Документы этой покупки:"
        keys={["purchase", "terms", "contacts", "privacy"]}
      />

      {existingAccess ? (
        <div className="mt-5 rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm leading-6">
          <p className="font-semibold">Этот продукт у вас уже открыт.</p>
          <p className="mt-1 text-muted-foreground">
            Повторная покупка не удваивает право и не продлевает уже открытое.
          </p>
          <label className="mt-3 flex items-start gap-3">
            <input
              checked={acknowledgeExistingAccess}
              className="mt-1 size-5 shrink-0 rounded border-input accent-primary"
              disabled={pending}
              id={acknowledgeId}
              onChange={onToggleAcknowledge}
              type="checkbox"
            />
            <span>Понимаю и всё равно хочу оплатить</span>
          </label>
        </div>
      ) : null}

      <Button
        className={`mt-6 h-auto min-h-12 w-full whitespace-normal text-base ${billingActionClass}`}
        disabled={!payable || pending}
        onClick={onPay}
        size="lg"
        type="button"
      >
        {pending
          ? "Готовим оплату…"
          : `Купить за ${formatKopecks(conditions.firstPriceKopecks)}`}
      </Button>

      {purchase === null ? null : (
        <div className="mt-6 border-t border-border pt-5 text-sm leading-6">
          <p className="font-semibold">{attemptStateLabel(purchase.state)}</p>
          <p className="mt-1 text-muted-foreground">
            {purchase.access === "ready"
              ? "Доступ открыт."
              : purchase.access === "preparing"
                ? "Оплата подтверждена, открываем доступ."
                : "Доступ откроется после подтверждения оплаты сервером."}
          </p>
          <Button
            className={`mt-3 ${billingActionClass}`}
            disabled={pending}
            onClick={onRefreshStatus}
            type="button"
            variant="outline"
          >
            Проверить состояние
          </Button>
        </div>
      )}

      {error === undefined ? null : (
        <p
          className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
}
