"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { billingErrorMessage } from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import {
  importRespondents,
  issueRespondentLink,
  respondentsStatus,
} from "../api/respondents.browser";
import type {
  RespondentImport,
  RespondentLink,
} from "../model/respondent-operations";
import {
  SurveyRespondentsView,
  type IssueRespondentLinkInput,
} from "./survey-respondents-view.client";

const queryKey = ["survey-respondents"];

/** Отказы выдачи объясняются словами владельца, а не кодами billing. */
const issueMessages: Partial<Record<string, string>> = {
  not_found:
    "Такого ника нет в списке или шаблон скидки не найден. Проверьте ник; если человек сменил его, добавьте новый ник загрузкой.",
  state_conflict:
    "Шаблон скидки должен быть архивным и ещё действующим по сроку: иначе он сам продаёт скидку или ссылка уже не сработает.",
  invalid_request: "Это не Telegram-ник: нужен @nick, nick или ссылка t.me.",
};

export function SurveyRespondentsPanel() {
  const cache = useQueryClient();
  const { operationId, completeOperation } = useRepeatableOperations();
  const [message, setMessage] = useState("");
  const [imported, setImported] = useState<RespondentImport | null>(null);
  const [link, setLink] = useState<RespondentLink | null>(null);
  // Адрес платформы известен только в браузере: ссылка собирается после ответа на выдачу.
  const [origin, setOrigin] = useState("");
  const status = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await respondentsStatus({
        operationId: crypto.randomUUID(),
      });
      if (!result.ok) throw new Error(billingErrorMessage(result.code));
      return result.value.result.value;
    },
  });
  function failed() {
    setMessage(
      "Ответ не получен. Повторите то же действие: повтор не выдаст вторую ссылку.",
    );
  }
  const importing = useMutation({
    mutationFn: importRespondents,
    onError: failed,
    onSuccess: (result) => {
      if (!result.ok) {
        setMessage(billingErrorMessage(result.code));
        return;
      }
      completeOperation("import");
      setMessage("");
      setImported(result.value.result.value);
      void cache.invalidateQueries({ queryKey });
    },
  });
  const issuing = useMutation({
    mutationFn: issueRespondentLink,
    onError: failed,
    onSuccess: (result) => {
      if (!result.ok) {
        setLink(null);
        setMessage(
          issueMessages[result.code] ?? billingErrorMessage(result.code),
        );
        return;
      }
      completeOperation("issue");
      setOrigin(window.location.origin);
      setMessage("");
      setLink(result.value.result.value);
      void cache.invalidateQueries({ queryKey });
    },
  });
  return (
    <SurveyRespondentsView
      busy={importing.isPending || issuing.isPending}
      data={status.data ?? null}
      error={status.error?.message ?? null}
      imported={imported}
      link={link}
      loading={status.isPending}
      message={message}
      onCopy={(text) => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setMessage("Скопировано.");
          },
          () => {
            setMessage("Скопируйте ссылку вручную.");
          },
        );
      }}
      onImport={(list) => {
        importing.mutate({
          operationId: operationId("import", { list }),
          list,
        });
      }}
      onIssue={(input: IssueRespondentLinkInput) => {
        issuing.mutate({ operationId: operationId("issue", input), ...input });
      }}
      onRefresh={() => {
        void cache.invalidateQueries({ queryKey });
      }}
      origin={origin}
    />
  );
}
