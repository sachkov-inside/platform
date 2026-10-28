"use client";

import type { PaymentLink } from "@/entities/subscription";
import { AdminDialog } from "@/shared/ui/admin";

import { PaymentLinkShare } from "./payment-link-share.client";

/**
 * Подробности ссылки из строки списка: на телефоне лист снизу, на компьютере диалог. Тот же вид,
 * что после создания, с состоянием и датой создания: скопировать, поделиться, открыть оформление.
 */
export function PaymentLinkDetailsDialog({
  link,
  onClose,
}: {
  readonly link: PaymentLink | null;
  readonly onClose: () => void;
}) {
  return (
    <AdminDialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={link !== null}
      title="Ссылка на оплату"
    >
      {link === null ? null : (
        <PaymentLinkShare details link={link} onDone={onClose} />
      )}
    </AdminDialog>
  );
}
