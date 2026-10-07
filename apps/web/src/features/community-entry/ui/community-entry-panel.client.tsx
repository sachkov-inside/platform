"use client";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";

import { readBillingEndpoint } from "@/entities/subscription";
import {
  selfRefreshingRead,
  unavailableRetryIntervalMs,
} from "@/shared/api/self-refreshing-query";

import { communityEntrySchema } from "../model/community-entry";
import { CommunityEntryView, pathActionClass } from "./community-entry-view";

/** Пока бот готовит вход, блок переспрашивает сервер: право уже есть, ссылка вот-вот появится. */
const preparingPollMs = 5_000;

export interface CommunityEntryPanelProps {
  /** Кнопка подключения Telegram; после возврата из бота она освежает этот блок. */
  readonly TelegramAction: ComponentType<{
    readonly className?: string;
    readonly onRefresh: () => Promise<void>;
  }>;
}

/** Производственный путь перехода в сообщество: одно чтение собственного состояния Account. */
export function CommunityEntryPanel({
  TelegramAction,
}: CommunityEntryPanelProps) {
  const query = useQuery({
    queryKey: ["account", "community-entry"],
    queryFn: () =>
      readBillingEndpoint("/api/account/community-entry", communityEntrySchema),
    // Человек ждёт бота и возвращается из Telegram: чтение освежается при возврате на вкладку.
    ...selfRefreshingRead,
    refetchInterval: (query) => {
      const result = query.state.data;
      if (result === undefined) return false;
      if (!result.ok)
        return result.code === "unauthorized"
          ? false
          : unavailableRetryIntervalMs;
      return result.value.kind === "preparing" ? preparingPollMs : false;
    },
  });
  const result = query.data;
  // Завершённую сессию объясняет сама страница покупки: блок сообщества её не повторяет.
  const failed =
    query.isError || (result?.ok === false && result.code !== "unauthorized");
  return (
    <CommunityEntryView
      entry={result?.ok === true ? result.value : null}
      error={failed}
      telegramAction={
        <TelegramAction
          className={pathActionClass}
          onRefresh={async () => {
            await query.refetch();
          }}
        />
      }
    />
  );
}
