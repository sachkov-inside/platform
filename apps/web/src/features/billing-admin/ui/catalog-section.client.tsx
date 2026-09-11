"use client";
import { useState } from "react";

import {
  billingActionClass,
  formatKopecks,
  formatMonths,
  type PriceSnapshot,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import type {
  ArchiveInput,
  SaveOfferInput,
  SavePaymentOptionInput,
  SavePromotionInput,
} from "../model/admin-operations";
import {
  AdminField,
  AdminSection,
  AdminTextArea,
  capabilityHint,
  formText,
  onAdminSubmit,
  optionalFormNumber,
  optionalFormText,
  parseCapabilities,
} from "./admin-form.client";
import type { AdminCommand } from "./admin-command";

export interface CatalogSectionProps {
  readonly offers: readonly PriceSnapshot[];
  readonly pending: boolean;
  readonly onSaveOffer: (input: AdminCommand<SaveOfferInput>) => void;
  readonly onArchiveOffer: (input: AdminCommand<ArchiveInput>) => void;
  readonly onPublishOffer: (input: AdminCommand<ArchiveInput>) => void;
  readonly onUnpublishOffer: (input: AdminCommand<ArchiveInput>) => void;
  readonly onSavePaymentOption: (
    input: AdminCommand<SavePaymentOptionInput>,
  ) => void;
  readonly onArchivePaymentOption: (input: AdminCommand<ArchiveInput>) => void;
  readonly onSavePromotion: (input: AdminCommand<SavePromotionInput>) => void;
  readonly onArchivePromotion: (input: AdminCommand<ArchiveInput>) => void;
}

export function CatalogSection({
  offers,
  pending,
  onSaveOffer,
  onArchiveOffer,
  onPublishOffer,
  onUnpublishOffer,
  onSavePaymentOption,
  onArchivePaymentOption,
  onSavePromotion,
  onArchivePromotion,
}: CatalogSectionProps) {
  const [benefitError, setBenefitError] = useState<string>();
  return (
    <>
      <AdminSection
        description="Варианты каталога с редакциями. Выключенный вариант не виден покупателю и не покупается, но остаётся здесь: включить его можно без пересоздания предложения. Архивные позиции не перечисляются."
        title="Действующий каталог"
      >
        {offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Активных вариантов нет.
          </p>
        ) : (
          <ul className="grid gap-3 text-sm">
            {catalogOffers(offers).map(({ offer, options }) => {
              const published = offer.published === true;
              return (
                <li
                  className="grid gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0"
                  key={offer.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">
                      {offer.name}
                    </span>
                    <span
                      className={
                        published
                          ? "rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent-hover"
                          : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                      }
                    >
                      {published ? "В продаже" : "Не продаётся"}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    offer {offer.id} r{offer.revision} ·{" "}
                    {options
                      .map(
                        (snapshot) =>
                          `option ${snapshot.paymentOption.id} r${String(snapshot.paymentOption.revision)} · ${formatMonths(snapshot.paymentOption.months)} · ${formatKopecks(snapshot.paymentOption.priceKopecks)}`,
                      )
                      .join(" · ")}
                  </span>
                  <form
                    onSubmit={onAdminSubmit(() => {
                      const toggle = published ? onUnpublishOffer : onPublishOffer;
                      toggle({ id: offer.id, expectedRevision: offer.revision });
                    })}
                  >
                    <p>
                      <Button
                        className={billingActionClass}
                        disabled={pending}
                        type="submit"
                        variant="outline"
                      >
                        {published ? "Снять с продажи" : "Вернуть в продажу"}
                      </Button>
                    </p>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        description="Состав предложения — независимые права. Строка `capability=12` задаёт срок в месяцах, `capability=null` — бессрочное право."
        title="Предложение"
      >
        <form
          className="grid gap-4"
          onSubmit={onAdminSubmit((form) => {
            const parsed = parseCapabilities(formText(form.get("offerBenefits")));
            if (parsed.invalid.length > 0) {
              setBenefitError(
                `Неизвестные права: ${parsed.invalid.join(", ")}. ${capabilityHint}`,
              );
              return;
            }
            setBenefitError(undefined);
            const revision = optionalFormNumber(form.get("offerRevision"));
            onSaveOffer({
              ...(revision === undefined ? {} : { expectedRevision: revision }),
              value: {
                id: formText(form.get("offerId")),
                name: formText(form.get("offerName")),
                benefits: [...parsed.capabilities],
                ...(parsed.periods.length === 0
                  ? {}
                  : { benefitPeriods: [...parsed.periods] }),
              },
            });
          })}
        >
          <AdminField
            hint="UUID существующего предложения или новый."
            label="Идентификатор"
            name="offerId"
            required
          />
          <AdminField
            label="Название"
            maxLength={200}
            name="offerName"
            required
          />
          <AdminTextArea
            hint={`По одному праву в строке. ${capabilityHint}`}
            label="Состав"
            name="offerBenefits"
            required
          />
          <AdminField
            hint="Пусто — создание нового предложения."
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="offerRevision"
          />
          {benefitError === undefined ? null : (
            <p className="text-sm text-destructive" role="alert">
              {benefitError}
            </p>
          )}
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
            >
              Сохранить предложение
            </Button>
          </p>
        </form>
        <ArchiveForm
          fieldName="archiveOffer"
          label="Архивировать предложение"
          onArchive={onArchiveOffer}
          pending={pending}
        />
      </AdminSection>

      <AdminSection
        description="Вариант оплаты хранит длительность и цену в копейках. Архивирование не меняет действующие подписки."
        title="Вариант оплаты"
      >
        <form
          className="grid gap-4"
          onSubmit={onAdminSubmit((form) => {
            const revision = optionalFormNumber(form.get("optionRevision"));
            onSavePaymentOption({
              ...(revision === undefined ? {} : { expectedRevision: revision }),
              value: {
                id: formText(form.get("optionId")),
                offerId: formText(form.get("optionOfferId")),
                months: Number(formText(form.get("optionMonths"))),
                priceKopecks: Number(formText(form.get("optionPrice"))),
                mode: "subscription",
              },
            });
          })}
        >
          <AdminField label="Идентификатор варианта" name="optionId" required />
          <AdminField
            label="Идентификатор предложения"
            name="optionOfferId"
            required
          />
          <AdminField
            inputMode="numeric"
            label="Месяцев"
            name="optionMonths"
            required
          />
          <AdminField
            hint="В копейках: 350000 — это 3 500 ₽."
            inputMode="numeric"
            label="Цена"
            name="optionPrice"
            required
          />
          <AdminField
            hint="Пусто — создание нового варианта."
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="optionRevision"
          />
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
            >
              Сохранить вариант
            </Button>
          </p>
        </form>
        <ArchiveForm
          fieldName="archiveOption"
          label="Архивировать вариант"
          onArchive={onArchivePaymentOption}
          pending={pending}
        />
      </AdminSection>

      <AdminSection
        description="Скидка действует в своём окне и только на перечисленные предложения и варианты. Пустые списки означают «все»."
        title="Скидка"
      >
        <form
          className="grid gap-4"
          onSubmit={onAdminSubmit((form) => {
            const revision = optionalFormNumber(form.get("promotionRevision"));
            const usageLimit = optionalFormNumber(form.get("promotionLimit"));
            onSavePromotion({
              ...(revision === undefined ? {} : { expectedRevision: revision }),
              value: {
                id: formText(form.get("promotionId")),
                name: formText(form.get("promotionName")),
                percent: Number(formText(form.get("promotionPercent"))),
                code: optionalFormText(form.get("promotionCode")) ?? null,
                startsAt: formText(form.get("promotionStartsAt")),
                endsAt: formText(form.get("promotionEndsAt")),
                offerIds: splitIds(formText(form.get("promotionOffers"))),
                paymentOptionIds: splitIds(
                  formText(form.get("promotionOptions")),
                ),
                usageLimit: usageLimit ?? null,
              },
            });
          })}
        >
          <AdminField label="Идентификатор скидки" name="promotionId" required />
          <AdminField
            label="Название"
            maxLength={200}
            name="promotionName"
            required
          />
          <AdminField
            inputMode="numeric"
            label="Процент"
            name="promotionPercent"
            required
          />
          <AdminField
            hint="Пусто — публичная скидка без кода."
            label="Промокод"
            name="promotionCode"
          />
          <AdminField
            hint="ISO 8601 со смещением: 2026-10-01T00:00:00+03:00."
            label="Начало"
            name="promotionStartsAt"
            required
          />
          <AdminField
            hint="ISO 8601 со смещением."
            label="Конец"
            name="promotionEndsAt"
            required
          />
          <AdminField
            hint="UUID через запятую; пусто — все."
            label="Предложения"
            name="promotionOffers"
          />
          <AdminField
            hint="UUID через запятую; пусто — все."
            label="Варианты оплаты"
            name="promotionOptions"
          />
          <AdminField
            hint="Пусто — без ограничения."
            inputMode="numeric"
            label="Лимит применений"
            name="promotionLimit"
          />
          <AdminField
            hint="Пусто — создание новой скидки."
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="promotionRevision"
          />
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
            >
              Сохранить скидку
            </Button>
          </p>
        </form>
        <ArchiveForm
          fieldName="archivePromotion"
          label="Архивировать скидку"
          onArchive={onArchivePromotion}
          pending={pending}
        />
      </AdminSection>
    </>
  );
}

/** Архивирование одинаково для предложения, варианта и скидки: идентификатор и редакция. */
function ArchiveForm({
  fieldName,
  label,
  pending,
  onArchive,
}: {
  readonly fieldName: string;
  readonly label: string;
  readonly pending: boolean;
  readonly onArchive: (input: AdminCommand<ArchiveInput>) => void;
}) {
  return (
    <form
      className="grid gap-4 border-t border-border pt-5"
      onSubmit={onAdminSubmit((form) => {
        onArchive({
          id: formText(form.get(`${fieldName}Id`)),
          expectedRevision: Number(formText(form.get(`${fieldName}Revision`))),
        });
      })}
    >
      <AdminField label={label} name={`${fieldName}Id`} required />
      <AdminField
        inputMode="numeric"
        label="Ожидаемая редакция"
        name={`${fieldName}Revision`}
        required
      />
      <p>
        <Button
          className={billingActionClass}
          disabled={pending}
          type="submit"
          variant="outline"
        >
          Архивировать
        </Button>
      </p>
    </form>
  );
}

export function splitIds(value: string): string[] {
  return value
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Тумблер продажи относится к предложению, а не к отдельному сроку: группируем его варианты. */
function catalogOffers(
  offers: readonly PriceSnapshot[],
): readonly {
  readonly offer: PriceSnapshot["offer"];
  readonly options: readonly PriceSnapshot[];
}[] {
  const byOffer = new Map<
    string,
    { offer: PriceSnapshot["offer"]; options: PriceSnapshot[] }
  >();
  for (const snapshot of offers) {
    const entry = byOffer.get(snapshot.offer.id);
    if (entry === undefined) {
      byOffer.set(snapshot.offer.id, {
        offer: snapshot.offer,
        options: [snapshot],
      });
    } else {
      entry.options.push(snapshot);
    }
  }
  return [...byOffer.values()];
}
