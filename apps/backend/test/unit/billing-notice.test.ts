import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  NOTICE_LIFETIME_MS, RENEWAL_REMINDER_LEAD_MS, attemptSourceRef, lifecycleWindow, noticeEvent,
  planRenewalReminder, renewalReminderSourceRef, type RenewalReminderSubject,
} from "../../src/modules/billing/domain/notice.js";

const subscriptionRef = randomUUID();
const accountId = randomUUID();
const paidUntil = new Date("2030-02-28T10:00:00Z");
const offer = { id: randomUUID(), revision: 1, name: "Материалы", benefits: ["materials"], archived: false };
const paymentOption = { id: randomUUID(), offerId: offer.id, revision: 1, months: 1, priceKopecks: 100_000, archived: false };
const snapshot = { offer, paymentOption, currency: "RUB", timezone: "Europe/Moscow", renewalPriceKopecks: 100_000 };
const active: RenewalReminderSubject = {
  id: subscriptionRef, accountId, state: "active", snapshot, pendingChange: {},
  paidUntil, periodIndex: 1, bindingCiphertext: "sealed", bindingRevokedAt: null,
};

describe("напоминание о списании", () => {
  test("появляется ровно за три дня до даты и берёт сумму из принятых условий", () => {
    const now = new Date(paidUntil.getTime() - RENEWAL_REMINDER_LEAD_MS);
    expect(planRenewalReminder(active, now)).toMatchObject({
      kind: "renewal_reminder", accountId, title: "Материалы", amountKopecks: 100_000,
      dueAt: paidUntil, notAfter: paidUntil, occurredAt: now,
      sourceRef: renewalReminderSourceRef(subscriptionRef, 2),
    });
    expect(planRenewalReminder(active, new Date(now.getTime() - 1))).toBeUndefined();
  });

  test("согласованное изменение варианта меняет и название, и сумму следующего периода", () => {
    const higher = { ...offer, id: randomUUID(), name: "Материалы + сопровождение", benefits: ["materials", "support"] };
    const pendingChange = {
      snapshot: { offer: higher, paymentOption: { ...paymentOption, offerId: higher.id, priceKopecks: 350_000 },
        promotion: null, currency: "RUB", timezone: "Europe/Moscow", firstPriceKopecks: 350_000, renewalPriceKopecks: 350_000 },
      acceptedAt: "2030-02-01T10:00:00.000Z", changeQuoteRef: randomUUID(),
    };
    expect(planRenewalReminder({ ...active, pendingChange }, new Date("2030-02-26T10:00:00Z")))
      .toMatchObject({ title: "Материалы + сопровождение", amountKopecks: 350_000 });
  });

  test("нет предстоящего списания — нет и повода", () => {
    const now = new Date("2030-02-26T10:00:00Z");
    expect(planRenewalReminder({ ...active, state: "canceled" }, now)).toBeUndefined();
    expect(planRenewalReminder({ ...active, bindingRevokedAt: now }, now)).toBeUndefined();
    expect(planRenewalReminder({ ...active, bindingCiphertext: null }, now)).toBeUndefined();
    expect(planRenewalReminder(active, paidUntil)).toBeUndefined();
    // Продление сдвигает период: следующий повод получает собственный ключ.
    expect(planRenewalReminder({ ...active, periodIndex: 2 }, now)?.sourceRef)
      .toBe(renewalReminderSourceRef(subscriptionRef, 3));
  });
});

describe("событие повода", () => {
  test("срок жизни считается от самого события, а не от момента, когда его заметили", () => {
    const occurredAt = new Date("2030-02-28T10:00:00Z");
    expect(lifecycleWindow(occurredAt)).toEqual({ occurredAt, notAfter: new Date(occurredAt.getTime() + NOTICE_LIFETIME_MS) });
  });

  test("каждая revision повода получает свой messageId при прежнем occurrenceRef", () => {
    const occurrenceRef = randomUUID();
    const occurrence = planRenewalReminder(active, new Date("2030-02-26T10:00:00Z"));
    if (!occurrence) throw new Error("Ожидался повод напоминания");
    const first = noticeEvent({ messageId: randomUUID(), occurrenceRef, sourceRevision: 1, occurrence });
    const second = noticeEvent({ messageId: randomUUID(), occurrenceRef, sourceRevision: 2, occurrence });
    expect(first).toMatchObject({ contractVersion: "inside.notification-event.v1", eventType: "billing.notice-ready",
      occurrenceRef, accountRef: accountId, kind: "renewal_reminder", sourceRevision: 1,
      occurredAt: "2030-02-26T10:00:00.000Z", notAfter: paidUntil.toISOString() });
    expect(second.messageId).not.toBe(first.messageId);
    expect(second.occurrenceRef).toBe(first.occurrenceRef);
  });

  test("окно без срока и повод чужой формы не превращаются в событие", () => {
    const occurrence = { ...active, kind: "payment_succeeded" as const, sourceRef: attemptSourceRef(randomUUID()),
      title: "Материалы", occurredAt: paidUntil, notAfter: paidUntil };
    expect(() => noticeEvent({ messageId: randomUUID(), occurrenceRef: randomUUID(), sourceRevision: 1, occurrence }))
      .toThrow("notice_window_invalid");
    expect(() => noticeEvent({ messageId: "not-a-uuid", occurrenceRef: randomUUID(), sourceRevision: 1,
      occurrence: { ...occurrence, notAfter: new Date(paidUntil.getTime() + 1_000) } })).toThrow();
  });
});
