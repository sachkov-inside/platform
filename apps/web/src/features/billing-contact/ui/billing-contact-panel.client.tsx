"use client";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import {
  confirmBillingContact,
  startBillingContact,
} from "../api/billing-contact.browser";
import {
  contactErrorMessage,
  type BillingContactState,
} from "../model/billing-contact";
import { resetBillingContact } from "../model/billing-contact-query";
import { announceBillingContactVerified } from "../model/billing-contact-verified-channel";
import { useBillingContact } from "../model/use-billing-contact.client";
import { BillingContactForm } from "./billing-contact-form.client";

export interface BillingContactPanelProps {
  readonly headingLevel?: "h1" | "h2";
  readonly onStateChange?: (state: BillingContactState) => void;
}

/**
 * Производственный путь контакта: собственный BFF, повторяемые команды и один presentation
 * interface с Storybook. Повтор той же попытки использует прежнюю ссылку на операцию.
 */
export function BillingContactPanel({
  headingLevel,
  onStateChange,
}: BillingContactPanelProps) {
  const queryClient = useQueryClient();
  const query = useBillingContact();
  const { operationId, completeOperation } = useRepeatableOperations();
  const [challenge, setChallenge] = useState<{
    challengeRef: string;
    email: string;
    delivery: "sent" | "unknown";
  } | null>(null);
  const [error, setError] = useState<string>();
  const [verified, setVerified] = useState(false);
  const [editing, setEditing] = useState(false);

  const state = query.data?.ok === true ? query.data : undefined;
  const failure = query.data?.ok === false ? query.data.code : undefined;
  useEffect(() => {
    if (state !== undefined) onStateChange?.(state);
  }, [onStateChange, state]);

  const start = useMutation({
    mutationFn: startBillingContact,
    retry: false,
    onSuccess: (result, input) => {
      if (!result.ok) {
        setError(contactErrorMessage(result.code));
        return;
      }
      // Следующее «отправить новый код» должно уйти в банк писем, а не вернуть прежний вызов.
      completeOperation("contact-start");
      setChallenge({
        challengeRef: result.challengeRef,
        email: input.email,
        delivery: result.delivery,
      });
      setError(undefined);
    },
  });
  const confirm = useMutation({
    mutationFn: confirmBillingContact,
    retry: false,
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(contactErrorMessage(result.code));
        return;
      }
      completeOperation("contact-confirm");
      setChallenge(null);
      setError(undefined);
      setVerified(true);
      setEditing(false);
      // Объявление уходит раньше ожидания: соседние поверхности не должны зависеть от того,
      // сколько длится перечитывание здесь и остался ли покупатель на этой странице. Свой ответ
      // сбрасывается прямо тут, до показа подтверждённого адреса, и этот путь работает и там,
      // где объявления недоступны.
      announceBillingContactVerified();
      await resetBillingContact(queryClient);
    },
  });

  const unavailable = failure !== undefined || query.isError;
  const sessionExpired = failure === "unauthorized";
  return (
    <BillingContactForm
      challenge={challenge}
      contact={state?.contact ?? null}
      documents={state?.documents ?? []}
      editing={editing}
      error={
        error ??
        (failure !== undefined && !sessionExpired
          ? contactErrorMessage(failure)
          : undefined)
      }
      {...(headingLevel === undefined ? {} : { headingLevel })}
      loading={query.isPending}
      onCancelEdit={() => {
        setEditing(false);
        setChallenge(null);
        setError(undefined);
      }}
      onConfirm={(code) => {
        if (challenge === null) return;
        setError(undefined);
        confirm.mutate({
          operationId: operationId("contact-confirm", {
            challengeRef: challenge.challengeRef,
            code,
          }),
          challengeRef: challenge.challengeRef,
          code,
        });
      }}
      onEdit={() => {
        setEditing(true);
        setVerified(false);
      }}
      onStart={(email) => {
        if (state === undefined) return;
        setVerified(false);
        setError(undefined);
        const expectedRevision = state.contact?.revision ?? 0;
        start.mutate({
          operationId: operationId("contact-start", { email, expectedRevision }),
          email,
          expectedRevision,
        });
      }}
      pending={start.isPending || confirm.isPending}
      sessionExpired={sessionExpired}
      unavailable={unavailable && !sessionExpired}
      verified={verified}
    />
  );
}
