import type { Metadata } from "next";
import { TelegramContinuationRoute } from "@/_pages/telegram-continuation.server";
export const instant = false;
export const metadata: Metadata = {
  title: "Получить доступ к курсу",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ attempt?: string }>;
}) {
  return (
    <TelegramContinuationRoute attemptId={(await searchParams).attempt ?? ""} />
  );
}
