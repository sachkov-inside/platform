"use client";
import { productCapability } from "@inside/access-capabilities";
import { useMaterialReading } from "@/entities/material";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { JourneyProgress } from "@/shared/ui/journey-progress";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

import {
  billingErrorMessage,
  type PreorderTerms,
  type PriceSnapshot,
  type PaymentLinkDetail,
  type PurchaseStatus,
} from "@/entities/subscription";
import { useBillingContact } from "@/features/billing-contact";
import {
  CheckoutFlow,
  useProductPurchase,
  ProductPaymentStatus,
} from "@/features/billing-checkout";
import {
  useCurrentBilling,
  announceCurrentBillingChange,
} from "@/features/billing-subscription";

import { ProductPurchaseView } from "./product-purchase-view";

export interface ProductPurchaseProps {
  readonly product: { readonly id?: string; readonly name: string } | null;
  /** Варианты покупки этого руководства: обычно один, но выбор поддержан с самого начала. */
  readonly offers: readonly PriceSnapshot[];
  readonly slug: string;
  readonly offerId?: string;
  readonly unavailable?: boolean;
  /** Промокод персональной ссылки владельца: переживает вход и уходит в расчёт цены. */
  readonly promoCode?: string;
  /** Пока поток набирается: день старта и цена после него, зачёркнутая рядом с ценой. */
  readonly preorder?: PreorderTerms | null;
  /**
   * Вошёл ли человек, по мнению сервера. Гость сразу видит приглашение войти, а его браузер не
   * читает покупки и контакт: ответ 401 был бы ошибкой в консоли и лишним запросом.
   */
  readonly signedIn?: boolean;
  readonly accountId?: string | null;
  readonly individualLink?: PaymentLinkDetail;
}

/** Неоплаченная форма: покупка по другой цене заменит её, если банк не принял оплату. */
const replaceableStates: readonly PurchaseStatus["state"][] = [
  "prepared",
  "sent",
  "pending",
];

/** Собственные покупки читает браузер: страница рендерится сервером и без них. */
export function ProductPurchase({
  product,
  offers,
  slug,
  unavailable = false,
  promoCode,
  offerId,
  preorder = null,
  signedIn = true,
  accountId = null,
  individualLink,
}: ProductPurchaseProps) {
  const billing = useCurrentBilling({ enabled: signedIn });
  // Контакт подставляет email, а редакции документов нужны для согласия при оплате.
  const contact = useBillingContact({ enabled: signedIn });
  const contactState = contact.data?.ok === true ? contact.data : null;
  const signedOut =
    billing.data?.ok === false && billing.data.code === "unauthorized";
  const viewer =
    !signedIn || signedOut ? "guest" : billing.isPending ? "loading" : "member";
  const failure =
    billing.data?.ok === false && !signedOut ? billing.data.code : undefined;
  const reading = useMaterialReading();
  const currentAccountId = reading.resolved ? reading.accountId : accountId;
  const restored = useProductPurchase(
    product?.id,
    signedIn && !signedOut,
    currentAccountId,
  );
  const [buyAgain, setBuyAgain] = useState(false);
  const purchase =
    restored.data?.ok === true ? (restored.data.value ?? null) : null;
  const restoredError =
    restored.data?.ok === false
      ? billingErrorMessage(restored.data.code)
      : restored.isError
        ? "Не удалось восстановить покупку."
        : undefined;
  // Покупка по другой цене заменит неоплаченную форму (#1925): страница ссылки и страница с
  // промокодом показывают оформление по своей цене, а не статус той формы. Применится ли
  // промокод, решает расчёт; при той же цене сервер продолжит прежнюю попытку.
  const atOtherPrice =
    purchase !== null &&
    (individualLink === undefined
      ? promoCode !== undefined
      : purchase.snapshot.individualPayment?.linkId !== individualLink.id);
  const openPurchase =
    buyAgain ||
    purchase === null ||
    purchase.state === "failed" ||
    (atOtherPrice && replaceableStates.includes(purchase.state))
      ? null
      : purchase;
  const ready = purchase?.access === "ready";
  const router = useRouter();
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || announced.current === purchase.purchaseRef) return;
    announced.current = purchase.purchaseRef;
    announceCurrentBillingChange();
    router.refresh();
  }, [ready, purchase, router]);
  const refreshedFailure = useRef<string | null>(null);
  useEffect(() => {
    if (
      purchase?.state !== "failed" ||
      individualLink === undefined ||
      !["pending", "unknown"].includes(individualLink.state) ||
      refreshedFailure.current === purchase.purchaseRef
    )
      return;
    refreshedFailure.current = purchase.purchaseRef;
    router.refresh();
  }, [purchase, individualLink, router]);
  const productId = product?.id;
  const alreadyOpen =
    productId !== undefined &&
    billing.data?.ok === true &&
    billing.data.value.access.grounds.some(
      (ground) =>
        ground.active &&
        (ground.capabilities.includes(productCapability(productId)) ||
          (ground.capabilities.includes("materials") &&
            ground.content?.some((entry) => entry.id === productId) === true)),
    );
  const selected =
    offers.find((item) => item.product?.id === productId) ?? null;

  return (
    <ProductPurchaseView
      {...(individualLink === undefined ? {} : { individualLink })}
      hasPurchase={
        openPurchase !== null ||
        alreadyOpen ||
        (signedIn &&
          !signedOut &&
          product?.id !== undefined &&
          restored.isPending)
      }
      progress={
        <JourneyProgress
          labels={["Вход", "Оплата", "Доступ"]}
          current={viewer === "guest" ? 0 : ready || alreadyOpen ? 2 : 1}
          completed={ready || alreadyOpen}
          label="Шаги покупки"
        />
      }
      product={product}
      offer={selected}
      {...(offerId === undefined ? {} : { offerId })}
      preorder={preorder}
      slug={slug}
      unavailable={unavailable}
      viewer={viewer}
      {...(promoCode === undefined ? {} : { promoCode })}
      {...(failure === undefined
        ? {}
        : { notice: billingErrorMessage(failure) })}
    >
      {signedIn && product?.id !== undefined && restored.isPending ? (
        <p role="status">Восстанавливаем вашу покупку…</p>
      ) : restoredError !== undefined ? (
        <section role="alert">
          <p>{restoredError}</p>
          <Button
            type="button"
            onClick={() => {
              void restored.refetch();
            }}
          >
            Попробовать ещё раз
          </Button>
        </section>
      ) : openPurchase !== null ? (
        <ProductPaymentStatus
          onBuyAgain={() => {
            setBuyAgain(true);
          }}
          purchase={openPurchase}
          programmeHref={productProgrammeHref(slug)}
          loading={restored.isFetching}
          onRefresh={() => {
            void restored.refetch();
          }}
        />
      ) : alreadyOpen ? (
        <Button asChild className="w-full">
          <Link href={productProgrammeHref(slug)}>Открыть продукт</Link>
        </Button>
      ) : selected === null ? null : contact.isPending ? (
        <p role="status">Подготавливаем оплату…</p>
      ) : contact.isError || !contact.data.ok ? (
        <section role="alert">
          <p>Не удалось загрузить данные оплаты.</p>
          <Button
            type="button"
            onClick={() => {
              void contact.refetch();
            }}
          >
            Попробовать ещё раз
          </Button>
        </section>
      ) : (
        <>
          <CheckoutFlow
            contact={contactState?.contact ?? null}
            initialEmail={contactState?.initialEmail}
            documents={contactState?.documents ?? []}
            onPurchase={() => {
              setBuyAgain(false);
              void restored.refetch();
            }}
            onDocumentsChanged={() => {
              void contact.refetch();
            }}
            preorder={preorder}
            snapshot={selected}
            {...(promoCode === undefined ? {} : { promoCode })}
          />
        </>
      )}
    </ProductPurchaseView>
  );
}
