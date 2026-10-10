import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { readLearningDestination } from "@/_pages/home.server";
import { internalRoute } from "@/shared/routing/internal-route";

/** Адрес только перенаправляет и зависит от сессии: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = {
  title: "Курс",
  robots: { follow: false, index: false },
};

/**
 * Пункт «Курс» навигации: ведёт купившего прямо в программу его курса, остальных — на Главную.
 * Так из витрины в прохождение одно нажатие (решение владельца 09.10.2026).
 */
export default async function LearningRoute() {
  redirect(internalRoute(await readLearningDestination()));
}
