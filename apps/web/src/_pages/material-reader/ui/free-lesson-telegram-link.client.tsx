"use client";

import { useRouter } from "next/navigation";

import { TelegramLinkAction } from "@/features/account-access";

/** После подключения Telegram урок перечитывается и открывается без перехода. */
export function FreeLessonTelegramLink() {
  const router = useRouter();
  return (
    <TelegramLinkAction
      className="h-auto min-h-11 max-w-full whitespace-normal rounded-xl bg-accent px-4 text-white hover:bg-accent-hover"
      label="Подключить Telegram"
      onRefresh={() => {
        router.refresh();
        return Promise.resolve();
      }}
    />
  );
}
