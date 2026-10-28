import type { Metadata } from "next";

import { AuthoringPersonPage } from "@/_pages/authoring-person.server";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = { title: "Карточка человека · Authoring" };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly accountId: string }>;
}) {
  const { accountId } = await params;
  return <AuthoringPersonPage accountId={accountId} />;
}
