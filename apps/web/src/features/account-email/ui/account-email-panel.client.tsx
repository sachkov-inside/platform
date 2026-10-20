"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { selfRefreshingRead } from "@/shared/api/self-refreshing-query";
import type {
  EmailAttachmentFailure,
  IdentityEmail,
} from "@/shared/auth/identity-account-contract";
import {
  confirmAccountEmail,
  readAccountEmail,
  startAccountEmail,
} from "../api/account-email.browser";
import { AccountEmailForm } from "./account-email-form.client";

const queryKey = ["account", "sign-in-email"] as const;
const errorMessage: Record<EmailAttachmentFailure["code"], string> = {
  unauthorized: "Войдите снова, чтобы продолжить.",
  invalid_input: "Проверьте адрес почты и шестизначный код.",
  challenge_invalid:
    "Код неверный или истёк. Проверьте письмо или запросите новый код.",
  email_conflict:
    "Не удалось привязать адрес. Возможно, он уже используется другим аккаунтом. Аккаунты не объединены.",
  rate_limited: "Слишком много попыток. Подождите перед повторным запросом.",
  unavailable: "Не удалось подтвердить почту. Повторите попытку позже.",
};
export function AccountEmailPanel() {
  const client = useQueryClient();
  const query = useQuery({
    ...selfRefreshingRead,
    queryKey,
    queryFn: readAccountEmail,
  });
  const [challenge, setChallenge] = useState<{
    email: string;
    challengeRef: string;
  } | null>(null);
  const [error, setError] = useState<EmailAttachmentFailure["code"]>();
  const [verified, setVerified] = useState(false);
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
      client.setQueryData<IdentityEmail>(queryKey, () => ({
        ok: true,
        email: challenge.email,
      }));
      setChallenge(null);
      setError(undefined);
      setVerified(true);
      await client.invalidateQueries({ queryKey });
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
      verified={verified}
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
