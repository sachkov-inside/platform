"use client";
import { NotificationChannelsPanel } from "@/features/notification-preferences";

/** Раздел «Уведомления»: по каким каналам приходят сообщения. */
export function AccountNotificationsPage() {
  return (
    <div>
      <header className="mb-8 border-b border-border pb-7">
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
          Уведомления
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Каналы, по которым мы пишем вам о новых материалах.
        </p>
      </header>

      <NotificationChannelsPanel />
    </div>
  );
}
