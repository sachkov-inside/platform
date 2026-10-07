"use client";

import type { Route } from "next";
import Link from "next/link";
import { ArrowUpRight, LoaderCircle, Send } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";

import { useTelegramLinkFlow } from "../model/use-telegram-link-flow.client";

/** Раздел кабинета с полным сценарием подключения: проверка, повтор и поддержка. */
const accessHref: Route = "/account/access";

export interface TelegramLinkActionProps {
  /** Перечитывает состояние, которое показывает кнопку, после каждого шага привязки. */
  readonly onRefresh: () => Promise<void>;
  readonly className?: string;
}

/**
 * Одна кнопка подключения Telegram рядом с покупкой: открывает бота с кодом привязки. Привязку
 * завершает сервер, а бот сам присылает ссылку в группу (#1037), поэтому возвращаться не нужно.
 * Редкие исходы (прежняя ссылка ещё действует, конфликт, сбой) ведут в раздел «Доступ».
 */
export function TelegramLinkAction({
  className,
  onRefresh,
}: TelegramLinkActionProps) {
  const flow = useTelegramLinkFlow(onRefresh);
  const result = flow.mutationResult;
  // Сетевой сбой `begin` не оставляет результата: без этой отметки человек не увидел бы ничего.
  const [attempted, setAttempted] = useState(false);

  if (flow.deepLink !== null) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild className={className}>
          <a href={flow.deepLink} rel="noopener noreferrer" target="_blank">
            <Send aria-hidden="true" />
            Открыть Telegram
          </a>
        </Button>
        <p className="text-xs leading-5 text-muted-foreground" role="status">
          Нажмите Start в боте — он сам пришлёт личную ссылку в группу.
        </p>
      </div>
    );
  }
  const detour =
    attempted &&
    !flow.pending &&
    (result?.kind !== "received" || result.state.status !== "linked");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button
        className={className}
        disabled={flow.pending}
        onClick={() => {
          void flow.begin().finally(() => {
            setAttempted(true);
          });
        }}
        type="button"
      >
        {flow.pending ? (
          <LoaderCircle
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : (
          <Send aria-hidden="true" />
        )}
        Подключить Telegram
      </Button>
      {detour ? (
        <p className="text-xs leading-5 text-muted-foreground" role="alert">
          {result?.kind === "unauthorized"
            ? "Сессия завершилась. Войдите снова, чтобы продолжить."
            : "Не получилось открыть бота отсюда."}{" "}
          <Link className="font-semibold underline" href={accessHref}>
            Подключить в разделе «Доступ»
            <ArrowUpRight
              aria-hidden="true"
              className="ml-0.5 inline size-3.5"
            />
          </Link>
        </p>
      ) : null}
    </div>
  );
}
