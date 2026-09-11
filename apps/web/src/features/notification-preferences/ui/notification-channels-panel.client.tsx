"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import {
  changeNotificationPreferences,
  readNotificationPreferences,
} from "../api/notification-preferences.browser";
import {
  notificationErrorMessage,
  type NotificationPreferences,
} from "../model/notification-preferences";
import {
  NotificationChannelsForm,
  type NotificationChannel,
} from "./notification-channels-form.client";

export const notificationPreferencesQueryKey = [
  "account",
  "notification-preferences",
] as const;

export function notificationPreferencesQueryOptions() {
  return {
    queryKey: notificationPreferencesQueryKey,
    queryFn: readNotificationPreferences,
    retry: false,
    staleTime: 0,
  };
}

/**
 * Производственный путь настроек: собственный BFF, ожидаемая revision и повторяемая команда.
 * Черновик остаётся у владельца аккаунта, пока он не нажал «Сохранить».
 */
export function NotificationChannelsPanel() {
  const queryClient = useQueryClient();
  const query = useQuery(notificationPreferencesQueryOptions());
  const { operationId, completeOperation } = useRepeatableOperations();
  const [draft, setDraft] = useState<Partial<
    Record<NotificationChannel, boolean>
  > | null>(null);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const stored: NotificationPreferences | null =
    query.data?.ok === true ? query.data.preferences : null;
  const failure = query.data?.ok === false ? query.data.code : undefined;
  const sessionExpired = failure === "unauthorized";
  const email = draft?.email ?? stored?.email ?? false;
  const telegram = draft?.telegram ?? stored?.telegram ?? false;
  const dirty =
    stored !== null &&
    (email !== stored.email || telegram !== stored.telegram);

  const save = useMutation({
    mutationFn: changeNotificationPreferences,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(notificationErrorMessage(result.code));
        void query.refetch();
        return;
      }
      completeOperation("notification-preferences");
      setError(undefined);
      setDraft(null);
      setSaved(true);
      queryClient.setQueryData(notificationPreferencesQueryKey, result);
    },
  });

  return (
    <NotificationChannelsForm
      accountHref="/account/access"
      dirty={dirty}
      email={email}
      error={
        error ??
        (failure !== undefined && !sessionExpired
          ? notificationErrorMessage(failure)
          : undefined)
      }
      loading={query.isPending}
      onChange={(channel, value) => {
        setSaved(false);
        setError(undefined);
        setDraft((current) => ({ ...current, [channel]: value }));
      }}
      onRefresh={() => {
        setError(undefined);
        void query.refetch();
      }}
      onSave={() => {
        if (stored === null) return;
        setError(undefined);
        save.mutate({
          operationId: operationId("notification-preferences", {
            expectedRevision: stored.revision,
            email,
            telegram,
          }),
          expectedRevision: stored.revision,
          email,
          telegram,
        });
      }}
      pending={save.isPending}
      saved={saved}
      sessionExpired={sessionExpired}
      telegram={telegram}
      unavailable={
        (failure !== undefined && !sessionExpired) ||
        (query.isError && stored === null)
      }
    />
  );
}
