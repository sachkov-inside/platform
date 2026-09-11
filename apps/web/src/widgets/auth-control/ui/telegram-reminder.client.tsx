"use client";
import { Send } from "lucide-react";

/**
 * Тихое напоминание в шапке, пока Telegram не подключён. Оно не уводит со страницы: объяснение
 * и само подключение открываются окном поверх текущей работы.
 */
export function TelegramReminder({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button
      aria-label="Telegram не подключён. Подключить"
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
      onClick={onOpen}
      title="Telegram не подключён"
      type="button"
    >
      <Send aria-hidden="true" className="size-5" />
      <span
        aria-hidden="true"
        className="absolute right-2 top-2 size-2 rounded-full bg-accent ring-2 ring-background"
      />
    </button>
  );
}
