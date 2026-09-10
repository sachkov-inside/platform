"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  confirmBillingContact,
  readBillingContact,
  startBillingContact,
} from "../api/billing-contact.browser";
import {
  contactErrorMessage,
  type BillingContactState,
  type ConfirmContactInput,
  type StartContactInput,
} from "../model/billing-contact";
import { BillingContactForm } from "./billing-contact-form.client";

export const billingContactQueryKey = ["account", "billing-contact"] as const;

export function billingContactQueryOptions() {
  return {
    queryKey: billingContactQueryKey,
    queryFn: readBillingContact,
    retry: false,
    staleTime: 0,
  };
}

export interface BillingContactPanelProps {
  readonly headingLevel?: "h1" | "h2";
  readonly onStateChange?: (state: BillingContactState) => void;
}

/**
 * Производственный путь контакта: собственный BFF, повторяемые команды и один presentation
 * interface с Storybook. Повтор той же попытки использует прежний operationId.
 */
export function BillingContactPanel({
  headingLevel,
  onStateChange,
}: BillingContactPanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery(billingContactQueryOptions());
  const [challenge, setChallenge] = useState<{
    challengeRef: string;
    email: string;
    delivery: "sent" | "unknown";
  } | null>(null);
  const [error, setError] = useState<string>();
  const [verified, setVerified] = useState(false);
  const [editing, setEditing] = useState(false);
  const startAttempt = useRef<StartContactInput | null>(null);
  const confirmAttempt = useRef<ConfirmContactInput | null>(null);
  useEffect(() => {
    if (query.data !== undefined) onStateChange?.(query.data);
  }, [onStateChange, query.data]);

  const start = useMutation({
    mutationFn: startBillingContact,
    retry: false,
    onSuccess: (result, input) => {
      if (!result.ok) {
        setError(contactErrorMessage(result.code));
        return;
      }
      startAttempt.current = null;
      confirmAttempt.current = null;
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
      setChallenge(null);
      confirmAttempt.current = null;
      setError(undefined);
      setVerified(true);
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: billingContactQueryKey });
    },
  });

  const sessionExpired =
    query.isError && query.error.message === "unauthorized";
  return (
    <BillingContactForm
      challenge={challenge}
      contact={query.data?.contact ?? null}
      documents={query.data?.documents ?? []}
      editing={editing}
      error={
        error ??
        (query.isError && !sessionExpired
          ? contactErrorMessage(query.error.message)
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
        if (
          confirmAttempt.current === null ||
          confirmAttempt.current.code !== code ||
          confirmAttempt.current.challengeRef !== challenge.challengeRef
        )
          confirmAttempt.current = {
            operationId: crypto.randomUUID(),
            challengeRef: challenge.challengeRef,
            code,
          };
        confirm.mutate(confirmAttempt.current);
      }}
      onEdit={() => {
        setEditing(true);
        setVerified(false);
      }}
      onRefresh={() => {
        setError(undefined);
        void query.refetch();
      }}
      onStart={(email) => {
        if (query.data === undefined) return;
        setVerified(false);
        setError(undefined);
        const expectedRevision = query.data.contact?.revision ?? 0;
        if (
          startAttempt.current === null ||
          startAttempt.current.email !== email ||
          startAttempt.current.expectedRevision !== expectedRevision
        )
          startAttempt.current = {
            operationId: crypto.randomUUID(),
            email,
            expectedRevision,
          };
        start.mutate(startAttempt.current);
      }}
      pending={start.isPending || confirm.isPending}
      sessionExpired={sessionExpired}
      unavailable={query.isError && !sessionExpired}
      verified={verified}
    />
  );
}
