"use client";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import type { Delivery, ResolveDelivery } from "../model/communications";
const labels = {
  pending: "Ожидает отправки",
  in_flight: "Отправляется",
  sent: "Отправлено",
  failed: "Ошибка",
  unknown: "Результат неизвестен",
  suppressed: "Пропущено по предпочтению получателя",
  skipped: "Пропущено владельцем",
  cancelled: "Отменено",
};
export function DeliveryHistory({
  deliveries,
  disabled,
  onSkip,
  onRetry,
}: {
  deliveries: Delivery[];
  disabled: boolean;
  onSkip: (input: ResolveDelivery) => void;
  onRetry: (input: ResolveDelivery) => void;
}) {
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-6">
      {deliveries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Отправок пока нет.
        </p>
      ) : (
        deliveries.map((delivery) => (
          <section
            key={delivery.deliveryId}
            className="space-y-4 rounded-lg border border-border bg-background p-4"
          >
            <h3 className="break-all text-sm font-medium">
              Контакт {delivery.contactId}
            </h3>
            <p className="text-sm">
              Версия сообщения: {delivery.publishedRevision}.{" "}
              {delivery.completedAt ? "Шаг завершён." : "Шаг ещё не завершён."}{" "}
              {delivery.cancelRequested
                ? "Запрошена отмена. Неизвестный результат требует решения."
                : ""}
            </p>
            {delivery.parts.map((part, i) => {
              const key = `${delivery.deliveryId}:${part.partId}`;
              const input = {
                operationId: crypto.randomUUID(),
                expectedRevision: delivery.revision,
                deliveryId: delivery.deliveryId,
                partId: part.partId,
                duplicateRiskAccepted: accepted[key] === true,
              };
              return (
                <div
                  key={part.partId}
                  className={`space-y-3 rounded-lg border p-4 ${part.state === "unknown" || part.state === "failed" ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}
                >
                  <p className="font-medium">
                    Часть {i + 1}: {labels[part.state]}
                  </p>
                  {part.diagnosticCode ? (
                    <p className="break-words text-sm">
                      Причина: {part.diagnosticCode}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {
                      delivery.snapshot.find((p) => p.partId === part.partId)
                        ?.content.text
                    }
                  </p>
                  {part.attempts.length > 0 ? (
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2 text-sm">
                        История попыток ({part.attempts.length})
                      </summary>
                      <ul>
                        {part.attempts.map((attempt) => (
                          <li
                            key={attempt.attemptId}
                            className="break-words py-1 text-sm"
                          >
                            {attempt.attemptedAt}: {attempt.outcome}
                            {attempt.diagnosticCode
                              ? ` · ${attempt.diagnosticCode}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {["failed", "unknown"].includes(part.state) &&
                  !delivery.completedAt ? (
                    <fieldset disabled={disabled} className="space-y-3">
                      <legend className="sr-only">
                        Решение по части {i + 1}
                      </legend>
                      {!delivery.cancelRequested ? (
                        <label className="flex min-h-12 items-center gap-3 text-sm">
                          <input
                            type="checkbox"
                            checked={accepted[key] === true}
                            onChange={(e) => {
                              setAccepted({
                                ...accepted,
                                [key]: e.target.checked,
                              });
                            }}
                          />
                          Я понимаю, что повторная отправка может создать дубль
                        </label>
                      ) : null}
                      <div className="flex flex-wrap gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-12"
                          onClick={() => {
                            onSkip(input);
                          }}
                        >
                          Пропустить часть {i + 1}
                        </Button>
                        {!delivery.cancelRequested ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-12"
                            disabled={!accepted[key]}
                            onClick={() => {
                              onRetry(input);
                            }}
                          >
                            Повторить часть {i + 1}
                          </Button>
                        ) : null}
                      </div>
                    </fieldset>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
