"use client";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";

import { readBillingEndpoint } from "@/entities/subscription";
import { selfRefreshingRead } from "@/shared/api/self-refreshing-query";

import { communityEntrySchema } from "../model/community-entry";
import { CommunityEntryView } from "./community-entry-view";

/** Пока бот готовит вход, блок переспрашивает сервер: право уже есть, ссылка вот-вот появится. */
const preparingPollMs = 5_000;

export interface CommunityEntryPanelProps {
  readonly telegramHref: Route;
}

/** Производственный путь перехода в сообщество: одно чтение собственного состояния Account. */
export function CommunityEntryPanel({
  telegramHref,
}: CommunityEntryPanelProps) {
  const query = useQuery({
    queryKey: ["account", "community-entry"],
    queryFn: () =>
      readBillingEndpoint("/api/account/community-entry", communityEntrySchema),
    // Человек ждёт бота и возвращается из Telegram: чтение освежается при возврате на вкладку.
    ...selfRefreshingRead,
    refetchInterval: (query) => {
      const result = query.state.data;
      return result?.ok === true && result.value.kind === "preparing"
        ? preparingPollMs
        : false;
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
      onRetry={() => {
        void query.refetch();
      }}
      telegramHref={telegramHref}
    />
  );
}
