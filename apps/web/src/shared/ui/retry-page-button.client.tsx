"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/shared/ui/button";

/**
 * Повтор страницы, которая не загрузилась. Ссылка на тот же адрес здесь не годится: браузер помнит
 * страницу в кеше маршрутов (ADR 0027) и показал бы тот же сбой без обращения к серверу.
 * `router.refresh()` этот кеш отбрасывает и перечитывает страницу.
 */
export function RetryPageButton() {
  const router = useRouter();
  return (
    <Button
      onClick={() => {
        router.refresh();
      }}
      size="lg"
    >
      <RefreshCw aria-hidden="true" />
      Повторить
    </Button>
  );
}
