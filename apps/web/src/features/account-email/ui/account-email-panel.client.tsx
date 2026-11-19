"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { EmailAttachmentFailure } from "@/shared/auth/identity-account-contract";
import { useAccountEmailQuery } from "../model/use-account-email-query.client";
import {
  confirmAccountEmail,
  startAccountEmail,
} from "../api/account-email.browser";
import { AccountEmailForm } from "./account-email-form.client";

const errorMessage: Record<EmailAttachmentFailure["code"], string> = {
  unauthorized: "Войдите снова, чтобы продолжить.",
  invalid_input: "Проверьте адрес почты и код из шести цифр.",
  challenge_invalid:
    "Код неверный или истёк. Проверьте письмо или запросите новый код.",
  email_conflict:
    "Не удалось добавить почту. Возможно, она занята другим аккаунтом. Аккаунты остались отдельными.",
  rate_limited: "Слишком много попыток. Попробуйте позже.",
  unavailable: "Не удалось подтвердить почту. Попробуйте позже.",
};
export function AccountEmailPanel() {
  const { query, publishAttachedEmail } = useAccountEmailQuery();
  const [challenge, setChallenge] = useState<{
    email: string;
    challengeRef: string;
  } | null>(null);
  const [error, setError] = useState<EmailAttachmentFailure["code"]>();
  const start = useMutation({
    mutationFn: startAccountEmail,
    retry: false,
    onSuccess: (result, email) => {
      if (!result.ok) {
        setError(result.code);
        return;
      }
      setChallenge({ email, challengeRef: result.challengeRef });
      setError(undefined);
    },
  });
  const confirm = useMutation({
    mutationFn: confirmAccountEmail,
    retry: false,
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(result.code);
        return;
      }
      if (challenge === null) return;
      setChallenge(null);
      setError(undefined);
      await publishAttachedEmail(challenge.email);
    },
  });
  return (
    <AccountEmailForm
      challenge={challenge}
      email={query.data?.ok === true ? query.data.email : null}
      error={
        error === undefined
          ? start.isError || confirm.isError
            ? errorMessage.unavailable
            : undefined
          : errorMessage[error]
      }
      loading={query.isPending}
      unavailable={query.isError || query.data?.ok === false}
      sessionExpired={
        error === "unauthorized" ||
        (query.data?.ok === false && query.data.code === "unauthorized")
      }
      pending={start.isPending || confirm.isPending}
      verified={confirm.data?.ok === true}
      onStart={(email) => {
        setError(undefined);
        start.mutate(email);
      }}
      onConfirm={(code) => {
        if (challenge !== null) {
          setError(undefined);
          confirm.mutate({ challengeRef: challenge.challengeRef, code });
        }
      }}
      onRetry={() => {
        void query.refetch();
      }}
      onChangeAddress={() => {
        setChallenge(null);
        setError(undefined);
      }}
    />
  );
}
