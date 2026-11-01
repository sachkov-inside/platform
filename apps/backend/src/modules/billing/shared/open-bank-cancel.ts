import { Prisma } from "../../../infrastructure/prisma/index.js";
import {
  bankCancelClosingEventKinds,
  paymentEventKind,
} from "../domain/payment-events.js";

/**
 * SQL правила `isBankCancelOpen` для покупки `purchaseRef`: отмены в банке ещё нет ни одного
 * закрывающего события. Запрос, который читает саму отметку, добавляет к нему её строку.
 */
export function bankCancelNotClosedSql(purchaseRef: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`not exists (
    select 1 from billing.payment_events as closed
    where closed.purchase_ref = ${purchaseRef}
      and closed.kind = any(${[...bankCancelClosingEventKinds]}::text[]))`;
}

/** SQL правила `isBankCancelOpen`: у покупки `purchaseRef` открыта отмена формы в банке. */
export function bankCancelOpenSql(purchaseRef: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`exists (
    select 1 from billing.payment_events as requested
    where requested.purchase_ref = ${purchaseRef}
      and requested.kind = ${paymentEventKind.bankCancelRequested})
    and ${bankCancelNotClosedSql(purchaseRef)}`;
}
