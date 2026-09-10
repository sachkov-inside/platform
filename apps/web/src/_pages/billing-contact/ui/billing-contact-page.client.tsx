"use client";
import Link from "next/link";

import { BillingContactPanel } from "@/features/billing-contact";

/** Отдельный маршрут контакта: та же панель работает внутри оформления подписки. */
export function BillingContactPage() {
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <Link className="text-sm underline underline-offset-4" href="/account">
        В аккаунт
      </Link>
      <h1 className="text-balance text-4xl font-bold tracking-[-0.04em]">
        Email для чеков и уведомлений
      </h1>
      <BillingContactPanel />
    </div>
  );
}
