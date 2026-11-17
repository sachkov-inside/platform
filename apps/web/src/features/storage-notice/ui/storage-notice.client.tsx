"use client";

import type { Route } from "next";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Button } from "@/shared/ui/button";

import { storageNoticeVisible } from "../model/storage-notice";

import {
  acknowledgeStorageNotice,
  mountStorageNotice,
  readStorageNoticeSnapshot,
  subscribeStorageNotice,
  type StorageNoticeSnapshot,
} from "./storage-notice.browser";

/**
 * Уведомление о хранении в браузере (cookies v2): без выбора, со ссылкой на документ. «Понятно»
 * запоминает номер редакции. Сервер его не рисует, поэтому разметка страницы не сдвигается.
 * Пока уведомление видно, его высота лежит в `--storage-notice-space`: оболочка добавляет её к
 * нижнему отступу страницы, чтобы подвал не оказался под плашкой.
 */
export function StorageNotice({
  edition,
  policyHref,
}: {
  readonly edition: number;
  readonly policyHref: Route;
}) {
  const snapshot = useSyncExternalStore<StorageNoticeSnapshot | null>(
    subscribeStorageNotice,
    readStorageNoticeSnapshot,
    () => null,
  );
  const visible =
    snapshot !== null &&
    storageNoticeVisible(snapshot.stored, edition) &&
    snapshot.fallbackEdition !== edition;
  if (!visible) return null;
  return (
    <section
      ref={mountStorageNotice}
      aria-label="Хранение в браузере"
      className="storage-notice fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-40 mx-auto max-w-xl rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl lg:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
    >
      <p className="text-sm leading-6">
        Используем cookies и другие данные в браузере для входа и работы функций
        сайта. Рекламы и сторонней аналитики нет.{" "}
        <Link
          className="text-action underline underline-offset-4"
          href={policyHref}
        >
          О cookies
        </Link>
      </p>
      <Button
        className="mt-3 min-h-11 px-4"
        onClick={() => {
          acknowledgeStorageNotice(edition);
        }}
        type="button"
      >
        Понятно
      </Button>
    </section>
  );
}
