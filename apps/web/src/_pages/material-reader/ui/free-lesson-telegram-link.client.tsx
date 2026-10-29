"use client";

import { useRouter } from "next/navigation";

import { TelegramLinkAction } from "@/features/account-access";

/** После подключения Telegram урок перечитывается и открывается без перехода. */
export function FreeLessonTelegramLink({
  className,
}: {
  readonly className: string;
}) {
  const router = useRouter();
  return (
    <TelegramLinkAction
      className={className}
      label="Подключить Telegram"
      onRefresh={() => {
        router.refresh();
        return Promise.resolve();
      }}
    />
  );
}
