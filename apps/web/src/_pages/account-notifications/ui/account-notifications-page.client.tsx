"use client";
import { NotificationChannelsPanel } from "@/features/notification-preferences";
import { AccountSectionHeader } from "@/widgets/account-cabinet";

/** Раздел «Уведомления»: по каким каналам приходят сообщения. */
export function AccountNotificationsPage() {
  return (
    <div>
      <AccountSectionHeader section="notifications" />
      <NotificationChannelsPanel />
    </div>
  );
}
