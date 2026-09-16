"use client";

import { useMutation } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { acceptTerms } from "../api/accept-terms.browser";
import type { AcceptTermsResult } from "../model/terms-acceptance";
import { WelcomeView } from "./welcome-view";

export interface WelcomeScreenProps {
  readonly document: { readonly version: string; readonly digest: string };
  readonly returning: boolean;
  readonly returnTo: string;
  readonly termsHref: Route;
  readonly privacyHref: Route;
  /** Переход после принятия; в историях его подменяют. */
  readonly onAccepted?: (returnTo: string) => void;
}

const messages: Readonly<Record<Exclude<AcceptTermsResult["kind"], "accepted">, string>> = {
  document_changed:
    "Условия только что обновились. Прочитайте действующую редакцию и нажмите кнопку снова.",
  unauthorized: "Сессия завершилась. Войдите снова.",
  unavailable: "Не получилось принять условия. Повторите — повторное нажатие безопасно.",
};

export function WelcomeScreen({
  document,
  returning,
  returnTo,
  termsHref,
  privacyHref,
  onAccepted,
}: WelcomeScreenProps) {
  const router = useRouter();
  // Одно нажатие — одна операция: повтор после сбоя присоединяется к ней, а не пишет вторую.
  const [operationId] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: acceptTerms,
    retry: false,
    onSuccess: (result) => {
      if (result.kind === "accepted") {
        // Полный переход: серверные маршруты и оболочка перечитывают состояние аккаунта.
        const navigate =
          onAccepted ??
          ((target: string) => {
            window.location.assign(target);
          });
        navigate(returnTo);
        return;
      }
      if (result.kind === "document_changed") router.refresh();
    },
  });
  const outcome = mutation.data;
  return (
    <WelcomeView
      error={outcome === undefined || outcome.kind === "accepted" ? undefined : messages[outcome.kind]}
      onAccept={() => {
        mutation.mutate({ operationId, version: document.version, digest: document.digest });
      }}
      pending={mutation.isPending || outcome?.kind === "accepted"}
      privacyHref={privacyHref}
      returning={returning}
      termsHref={termsHref}
    />
  );
}
