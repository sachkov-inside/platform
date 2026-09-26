"use client";
import { useEffect } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import {
  subscribeEnrollmentChange,
  EnrollmentList,
  readBillingEndpoint,
  billingErrorMessage,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useOwnEnrollments } from "../model/use-own-enrollments.client";
export function EnrollmentsPanel() {
  const query = useOwnEnrollments();
  const admission = useQuery({
    queryKey: ["own-community-admission"],
    queryFn: async () => {
      const result = await readBillingEndpoint(
        "/api/account/billing/community-admission",
        z.strictObject({
          admissionRestriction: z
            .enum(["none", "moderation", "external_unknown"])
            .nullable(),
          state: z.enum([
            "checking",
            "no_access",
            "moderation_blocked",
            "ready",
          ]),
        }),
      );
      if (!result.ok) throw new Error(billingErrorMessage(result.code));
      return result.value;
    },
  });
  const refreshAdmission = admission.refetch;
  useEffect(
    () =>
      subscribeEnrollmentChange(() => {
        void refreshAdmission();
      }),
    [refreshAdmission],
  );
  const admissionText =
    admission.data?.admissionRestriction === "moderation"
      ? "Вступление в сообщество ограничено модерацией. Доступ к материалам сохраняется."
      : admission.data?.admissionRestriction === "external_unknown"
        ? "Telegram сообщает об ограничении вступления. Причину нужно уточнить у поддержки. Материалы доступны независимо."
        : admission.data?.state === "ready"
          ? "Право на сообщество подтверждено."
          : admission.data?.state === "no_access"
            ? "Действующего права на сообщество нет."
            : "Проверяем возможность вступления в сообщество…";
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <p role="status" className="mb-4 text-sm">
        {admissionText}
      </p>
      {admission.isError ? (
        <Button onClick={() => void admission.refetch()}>
          Повторить проверку сообщества
        </Button>
      ) : null}
      <h2 className="mb-4 text-xl font-semibold">Ваши тарифы</h2>
      {query.isPending ? (
        <p role="status">Загружаем назначения…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button onClick={() => void query.refetch()}>
            Повторить загрузку
          </Button>
        </div>
      ) : (
        <EnrollmentList items={query.data} />
      )}
    </section>
  );
}
