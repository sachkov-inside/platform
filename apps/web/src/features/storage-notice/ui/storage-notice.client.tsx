"use client";

import type { Route } from "next";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Button } from "@/shared/ui/button";

import { storageNoticeKey, storageNoticeVisible } from "../model/storage-notice";

const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(storageNoticeKey);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageNoticeKey) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function remember(edition: number): void {
  try {
    window.localStorage.setItem(storageNoticeKey, String(edition));
  } catch {
    // Хранилище запрещено: уведомление скроется до перезагрузки страницы.
  }
  hiddenWithoutStorage = true;
  for (const listener of listeners) listener();
}

let hiddenWithoutStorage = false;

/**
 * Уведомление о хранении в браузере (cookies v2): без выбора, со ссылкой на документ. «Понятно»
 * запоминает номер редакции. Сервер его не рисует, поэтому разметка страницы не сдвигается.
 */
export function StorageNotice({
  edition,
  policyHref,
}: {
  readonly edition: number;
  readonly policyHref: Route;
}) {
  const stored = useSyncExternalStore(subscribe, readStored, () => String(edition));
  if (!storageNoticeVisible(stored, edition) || (hiddenWithoutStorage && stored === null))
    return null;
  return (
    <section
      aria-label="Хранение в браузере"
      className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-40 mx-auto max-w-xl rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl lg:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
    >
      <p className="text-sm leading-6">
        Inside хранит в браузере только то, без чего не работают вход и сохранение прогресса.
        Рекламы и сторонней аналитики нет.{" "}
        <Link className="text-action underline underline-offset-4" href={policyHref}>
          Подробнее
        </Link>
      </p>
      <Button
        className="mt-3 min-h-11 px-4"
        onClick={() => {
          remember(edition);
        }}
        type="button"
      >
        Понятно
      </Button>
    </section>
  );
}
