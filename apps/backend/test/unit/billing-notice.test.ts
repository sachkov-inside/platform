import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { offerCheckoutPath } from "../../src/modules/billing/domain/offer-checkout.js";
import {
  NOTICE_LIFETIME_MS,
  RENEWAL_REMINDER_LEAD_MS,
  accessEndingSourceRef,
  attemptSourceRef,
  continuesAccessEndingReminder,
  enrollmentOfNotice,
  planAccessEnded,
  planAccessEnding,
  planSubscriptionEnding,
  subscriptionEndingSourceRef,
  type AccessEndingSubject,
  lifecycleWindow,
  noticeEvent,
  planRenewalReminder,
  renewalReminderSourceRef,
  type RenewalReminderSubject,
} from "../../src/modules/billing/domain/notice.js";

const subscriptionRef = randomUUID();
const accountId = randomUUID();
const paidUntil = new Date("2030-02-28T10:00:00Z");
const offer = {
  id: randomUUID(),
  revision: 1,
  name: "Материалы",
  benefits: ["materials"],
  archived: false,
};
const paymentOption = {
  id: randomUUID(),
  offerId: offer.id,
  revision: 1,
  months: 1,
  priceKopecks: 100_000,
  archived: false,
};
const snapshot = {
  offer,
  paymentOption,
  currency: "RUB",
  timezone: "Europe/Moscow",
  renewalPriceKopecks: 100_000,
};
const active: RenewalReminderSubject = {
  subscriptionRef,
  accountId,
  ended: false,
  scheduled: true,
  snapshot,
  pendingChange: {},
  paidUntil,
  nextPeriodIndex: 2,
};

describe("напоминание о списании", () => {
  test("появляется ровно за три дня до даты и берёт сумму из принятых условий", () => {
    const now = new Date(paidUntil.getTime() - RENEWAL_REMINDER_LEAD_MS);
    expect(planRenewalReminder(active, now)).toMatchObject({
      kind: "renewal_reminder",
      accountId,
      title: "Материалы",
      amountKopecks: 100_000,
      dueAt: paidUntil,
      notAfter: paidUntil,
      occurredAt: now,
      sourceRef: renewalReminderSourceRef(subscriptionRef, 2),
    });
    expect(
      planRenewalReminder(active, new Date(now.getTime() - 1)),
    ).toBeUndefined();
  });

  test("согласованное изменение варианта меняет и название, и сумму следующего периода", () => {
    const higher = {
      ...offer,
      id: randomUUID(),
      name: "Материалы + сопровождение",
      benefits: ["materials", "support"],
    };
    const pendingChange = {
      snapshot: {
        offer: higher,
        paymentOption: {
          ...paymentOption,
          offerId: higher.id,
          priceKopecks: 350_000,
        },
        promotion: null,
        currency: "RUB",
        timezone: "Europe/Moscow",
        firstPriceKopecks: 350_000,
        renewalPriceKopecks: 350_000,
      },
      acceptedAt: "2030-02-01T10:00:00.000Z",
      changeQuoteRef: randomUUID(),
    };
    expect(
      planRenewalReminder(
        { ...active, pendingChange },
        new Date("2030-02-26T10:00:00Z"),
      ),
    ).toMatchObject({
      title: "Материалы + сопровождение",
      amountKopecks: 350_000,
    });
  });

  test("нет предстоящего списания — нет и повода", () => {
    const now = new Date("2030-02-26T10:00:00Z");
    // Отменённое расписание, отозванная привязка и её отсутствие — один и тот же ответ источника.
    expect(
      planRenewalReminder({ ...active, scheduled: false }, now),
    ).toBeUndefined();
    expect(planRenewalReminder(active, paidUntil)).toBeUndefined();
    // Продление сдвигает период: следующий повод получает собственный ключ.
    expect(
      planRenewalReminder({ ...active, nextPeriodIndex: 3 }, now)?.sourceRef,
    ).toBe(renewalReminderSourceRef(subscriptionRef, 3));
  });
});

describe("событие повода", () => {
  test("срок жизни считается от самого события, а не от момента, когда его заметили", () => {
    const occurredAt = new Date("2030-02-28T10:00:00Z");
    expect(lifecycleWindow(occurredAt)).toEqual({
      occurredAt,
      notAfter: new Date(occurredAt.getTime() + NOTICE_LIFETIME_MS),
    });
  });

  test("каждая revision повода получает свой messageId при прежнем occurrenceRef", () => {
    const occurrenceRef = randomUUID();
    const occurrence = planRenewalReminder(
      active,
      new Date("2030-02-26T10:00:00Z"),
    );
    if (!occurrence) throw new Error("Ожидался повод напоминания");
    const first = noticeEvent({
      messageId: randomUUID(),
      occurrenceRef,
      sourceRevision: 1,
      occurrence,
    });
    const second = noticeEvent({
      messageId: randomUUID(),
      occurrenceRef,
      sourceRevision: 2,
      occurrence,
    });
    expect(first).toMatchObject({
      contractVersion: "inside.notification-event.v1",
      eventType: "billing.notice-ready",
      occurrenceRef,
      accountRef: accountId,
      kind: "renewal_reminder",
      sourceRevision: 1,
      occurredAt: "2030-02-26T10:00:00.000Z",
      notAfter: paidUntil.toISOString(),
    });
    expect(second.messageId).not.toBe(first.messageId);
    expect(second.occurrenceRef).toBe(first.occurrenceRef);
  });

  test("окно без срока и повод чужой формы не превращаются в событие", () => {
    const occurrence = {
      ...active,
      kind: "payment_succeeded" as const,
      sourceRef: attemptSourceRef(randomUUID()),
      title: "Материалы",
      occurredAt: paidUntil,
      notAfter: paidUntil,
    };
    expect(() =>
      noticeEvent({
        messageId: randomUUID(),
        occurrenceRef: randomUUID(),
        sourceRevision: 1,
        occurrence,
      }),
    ).toThrow("notice_window_invalid");
    expect(() =>
      noticeEvent({
        messageId: "not-a-uuid",
        occurrenceRef: randomUUID(),
        sourceRevision: 1,
        occurrence: {
          ...occurrence,
          notAfter: new Date(paidUntil.getTime() + 1_000),
        },
      }),
    ).toThrow();
  });
});

describe("окончание неоплаченного доступа", () => {
  const enrollmentId = randomUUID();
  const endsAt = new Date("2030-03-10T00:00:00Z");
  const gift: AccessEndingSubject = {
    enrollmentId,
    accountId,
    offerId: randomUUID(),
    title: "Материалы",
    endsAt,
    continued: false,
  };
  const reminderRef = accessEndingSourceRef(enrollmentId, 1);

  test("напоминание появляется за три дня до границы и ведёт на продление", () => {
    const now = new Date(endsAt.getTime() - RENEWAL_REMINDER_LEAD_MS);
    expect(planAccessEnding(gift, reminderRef, now)).toEqual({
      kind: "access_ending",
      accountId,
      sourceRef: reminderRef,
      title: "Материалы",
      dueAt: endsAt,
      occurredAt: now,
      notAfter: endsAt,
    });
    expect(
      planAccessEnding(gift, reminderRef, new Date(now.getTime() - 1)),
    ).toBeUndefined();
    expect(planAccessEnding(gift, reminderRef, endsAt)).toBeUndefined();
  });

  test("доступ, который продолжает другое основание, не заканчивается и повода не даёт", () => {
    const continued = { ...gift, continued: true };
    expect(
      planAccessEnding(
        continued,
        reminderRef,
        new Date("2030-03-08T00:00:00Z"),
      ),
    ).toBeUndefined();
    expect(planAccessEnded(continued, endsAt)).toBeUndefined();
  });

  test("окончание сообщается с самой границы и только в пределах срока жизни повода", () => {
    const ended = planAccessEnded(gift, endsAt);
    expect(ended).toMatchObject({
      kind: "access_expired",
      accountId,
      title: "Материалы",
      dueAt: endsAt,
      occurredAt: endsAt,
      notAfter: new Date(endsAt.getTime() + NOTICE_LIFETIME_MS),
    });
    // Позже замеченная граница даёт тот же повод: ключ — сам срок, а не момент наблюдения.
    expect(
      planAccessEnded(gift, new Date(endsAt.getTime() + 60_000))?.sourceRef,
    ).toBe(ended?.sourceRef);
    expect(
      planAccessEnded(gift, new Date(endsAt.getTime() - 1)),
    ).toBeUndefined();
    expect(
      planAccessEnded(gift, new Date(endsAt.getTime() + NOTICE_LIFETIME_MS)),
    ).toBeUndefined();
    // Новый срок после восстановления — новая граница и новый повод.
    expect(
      planAccessEnded(
        { ...gift, endsAt: new Date("2030-04-10T00:00:00Z") },
        new Date("2030-04-10T00:00:00Z"),
      )?.sourceRef,
    ).not.toBe(ended?.sourceRef);
    if (ended === undefined) throw new Error("Ожидался повод окончания");
    expect(enrollmentOfNotice(ended.sourceRef)).toBe(enrollmentId);
    expect(enrollmentOfNotice(reminderRef)).toBe(enrollmentId);
  });

  test("перенос срока внутри окна продолжает прежнее напоминание, а продление дальше окна начинает следующее", () => {
    expect(
      continuesAccessEndingReminder(endsAt, new Date("2030-03-11T00:00:00Z")),
    ).toBe(true);
    expect(
      continuesAccessEndingReminder(endsAt, new Date("2030-03-09T00:00:00Z")),
    ).toBe(true);
    expect(
      continuesAccessEndingReminder(endsAt, new Date("2030-04-10T00:00:00Z")),
    ).toBe(false);
    expect(accessEndingSourceRef(enrollmentId, 2)).not.toBe(reminderRef);
  });

  test("ключ повода чужой формы не называет Enrollment", () => {
    expect(enrollmentOfNotice(`subscription:${randomUUID()}:ended`)).toBe(
      undefined,
    );
    expect(enrollmentOfNotice(`enrollment:${"-".repeat(36)}:ended:1`)).toBe(
      undefined,
    );
    expect(enrollmentOfNotice(`${reminderRef}:extra`)).toBe(undefined);
  });
});

describe("окончание оплаченного срока без продления", () => {
  const canceled = { ...active, scheduled: false, continued: false };
  const now = new Date(paidUntil.getTime() - RENEWAL_REMINDER_LEAD_MS);

  test("без расписания за три дня приходит напоминание об окончании, а не о списании", () => {
    expect(planRenewalReminder(canceled, now)).toBeUndefined();
    expect(planSubscriptionEnding(canceled, now)).toEqual({
      kind: "access_ending",
      accountId,
      sourceRef: subscriptionEndingSourceRef(subscriptionRef, 1),
      subscriptionRef,
      title: "Материалы",
      occurredAt: now,
      notAfter: paidUntil,
      dueAt: paidUntil,
    });
  });

  test("действующее расписание, завершённая подписка и время вне окна повода не дают", () => {
    expect(
      planSubscriptionEnding({ ...active, continued: false }, now),
    ).toBeUndefined();
    expect(
      planSubscriptionEnding({ ...canceled, ended: true }, now),
    ).toBeUndefined();
    expect(
      planSubscriptionEnding(canceled, new Date(now.getTime() - 1)),
    ).toBeUndefined();
    expect(planSubscriptionEnding(canceled, paidUntil)).toBeUndefined();
  });

  test("доступ, который продолжает Enrollment на тот же тариф, на границе не заканчивается", () => {
    expect(
      planSubscriptionEnding({ ...canceled, continued: true }, now),
    ).toBeUndefined();
  });

  test("продление ведёт на оформление того же Offer через один адрес", () => {
    expect(offerCheckoutPath(offer.id)).toBe(
      `/payment/checkout?offer=${offer.id}`,
    );
    expect(() => offerCheckoutPath("not-an-offer")).toThrow();
  });
});
