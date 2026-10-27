import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  NOTICE_LIFETIME_MS,
  attemptSourceRef,
  lifecycleWindow,
  noticeEvent,
} from "../../src/modules/billing/domain/notice.js";
const accountId = randomUUID();
const paidUntil = new Date("2030-02-28T10:00:00Z");
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
    const occurrence = {
      kind: "payment_succeeded" as const,
      accountId,
      sourceRef: attemptSourceRef(randomUUID()),
      title: "Product purchase",
      occurredAt: new Date("2030-02-26T10:00:00Z"),
      notAfter: paidUntil,
    };
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
      kind: "payment_succeeded",
      sourceRevision: 1,
      occurredAt: "2030-02-26T10:00:00.000Z",
      notAfter: paidUntil.toISOString(),
    });
    expect(second.messageId).not.toBe(first.messageId);
    expect(second.occurrenceRef).toBe(first.occurrenceRef);
  });

  test("окно без срока и повод чужой формы не превращаются в событие", () => {
    const occurrence = {
      accountId,
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
