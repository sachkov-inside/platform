"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  readBillingContact,
  startBillingContact,
  confirmBillingContact,
} from "../api/billing-contact.browser";
import {
  contactErrorMessage,
  type StartContactInput,
  type ConfirmContactInput,
} from "../model/billing-contact";
import { BillingContactForm } from "./billing-contact-form.client";

const contactQueryKey = ["account", "billing-contact"] as const;
export function BillingContactPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: contactQueryKey,
    queryFn: readBillingContact,
    retry: false,
    staleTime: 0,
  });
  const [challenge, setChallenge] = useState<{
    challengeRef: string;
    email: string;
    delivery: "sent" | "unknown";
  } | null>(null);
  const [error, setError] = useState<string>();
  const [verified, setVerified] = useState(false);
  const startAttempt = useRef<StartContactInput | null>(null);
  const confirmAttempt = useRef<ConfirmContactInput | null>(null);
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
      await queryClient.invalidateQueries({ queryKey: contactQueryKey });
    },
  });
  return (
    <BillingContactForm
      contact={query.data?.contact ?? null}
      loading={query.isPending}
      pending={start.isPending || confirm.isPending}
      unavailable={query.isError}
      challenge={challenge}
      verified={verified}
      error={
        error ??
        (query.isError ? contactErrorMessage(query.error.message) : undefined)
      }
      onRefresh={() => {
        setError(undefined);
        void query.refetch();
      }}
      onStart={(email) => {
        if (!query.data) return;
        setVerified(false);
        setError(undefined);
        const expectedRevision = query.data.contact?.revision ?? 0;
        if (
          !startAttempt.current ||
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
      onConfirm={(code) => {
        if (!challenge) return;
        setError(undefined);
        if (
          !confirmAttempt.current ||
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
    />
  );
}
