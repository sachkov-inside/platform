"use client";

import { AdminDialog, StateBadge } from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import type { PromotionListItem } from "../model/promotion-operations";
import { promotionBadge, type PromotionState } from "../model/promotion-state";
import {
  promotionPeriodLabel,
  promotionReadOnlyReason,
  promotionUsageLabel,
  scopeText,
  type PromotionScope,
} from "../model/promotions-presentation";

/** Скидка из строки списка, которую изменить нельзя: её состояние на момент чтения и область. */
export interface PromotionDetails {
  readonly item: PromotionListItem;
  readonly state: PromotionState;
  readonly scope: PromotionScope;
}

/**
 * Подробности скидки только для чтения: архивная запись, прежняя область или анкетная скидка.
 * На телефоне лист снизу, на компьютере диалог. Изменить такую скидку нельзя, поэтому формы нет.
 */
export function PromotionDetailsDialog({
  details,
  onClose,
}: {
  readonly details: PromotionDetails | null;
  readonly onClose: () => void;
}) {
  return (
    <AdminDialog
      description={
        details === null ? undefined : promotionReadOnlyReason(details.item)
      }
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={details !== null}
      title={details === null ? "Скидка" : details.item.name}
    >
      {details === null ? null : (
        <div className="grid gap-5" data-promotion-details>
          <StateBadge state={promotionBadge(details.state)} />
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Fact label="Скидка">{`${String(details.item.percent)} %`}</Fact>
            <Fact label="Промокод">{details.item.code ?? "Без промокода"}</Fact>
            <Fact label="Период">{promotionPeriodLabel(details.item)}</Fact>
            <Fact label="Применения">{promotionUsageLabel(details.item)}</Fact>
            <div className="grid gap-1 sm:col-span-2">
              <dt className="text-muted-foreground">Продукты</dt>
              <dd className="[overflow-wrap:anywhere]">
                {scopeText(details.scope)}
              </dd>
            </div>
          </dl>
          <div className="admin-dialog-footer">
            <Button
              className="min-h-11 px-4"
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Закрыть
            </Button>
          </div>
        </div>
      )}
    </AdminDialog>
  );
}

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: string;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}
