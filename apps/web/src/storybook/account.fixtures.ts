import type { PrivateMemberProfile } from "@/entities/member-profile";
import type { AccountTelegramMembership } from "@/features/account-access";

import {
  accessGrounds,
  activeSubscription,
  billingNotices,
  currentBillingResponse,
  enrollmentsResponse,
  ownPayments,
} from "./billing.fixtures";
import type { MutationFetch } from "./mutation-mock";

/** Ответ маршрута BFF; обещание, которое не исполняется, держит страницу в загрузке. */
export type RouteResponse = () => Response | Promise<Response>;

/** Ответ, который не приходит: страница остаётся в своём состоянии загрузки. */
export const pendingResponse: RouteResponse = () =>
  new Promise<Response>(() => undefined);

/** Сессия закончилась: собственный BFF отвечает 401 без тела. */
export const unauthorizedResponse: RouteResponse = () =>
  new Response(null, { status: 401 });

/**
 * Ответы собственных BFF по пути запроса, как их отдаёт приложение. Путь без ответа отвечает 404:
 * так story не зависит от того, какие ещё чтения сделает оболочка вокруг страницы.
 */
export function respondByPath(
  routes: Readonly<Record<string, RouteResponse>>,
): MutationFetch {
  return async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const route = routes[new URL(url, window.location.origin).pathname];
    return route === undefined
      ? new Response(null, { status: 404 })
      : await route();
  };
}

/** Профиль участника, который он заполнил сам. */
export const memberProfile = {
  avatar: null,
  bio: "Развиваю инженерные команды и изучаю agent-first delivery.",
  createdAt: "2026-08-30T10:00:00.000Z",
  displayName: "Кирилл Сачков",
  status: "active",
  updatedAt: "2026-08-30T10:00:00.000Z",
  version: 3,
} as const satisfies PrivateMemberProfile;

/** Аккаунт участника, которым story открывает оболочку и кабинет. */
export const memberAccountId = "00000000-0000-4000-8000-00000000a001";

/**
 * Ответ `/api/account`: профиль и связь с Telegram. Его читают и оболочка (напоминание о
 * Telegram), и разделы «Профиль» и «Аккаунт».
 */
export function accountPresentationResponse({
  link = { kind: "linked" },
  profile = memberProfile,
}: {
  readonly link?: AccountTelegramMembership["link"];
  readonly profile?: PrivateMemberProfile | null;
} = {}): Response {
  return Response.json({
    profile:
      profile === null ? { kind: "missing" } : { kind: "profile", profile },
    telegramMembership: { link, membership: { kind: "active" } },
  });
}

/** Настройки каналов уведомлений владельца аккаунта. */
export function notificationPreferencesResponse({
  email = false,
  telegram = false,
}: {
  readonly email?: boolean;
  readonly telegram?: boolean;
} = {}): Response {
  return Response.json({
    ok: true,
    preferences: { revision: 4, email, telegram },
  });
}

/**
 * Чтения, которые делают оболочка и рамка кабинета у участника с действующей подпиской: профиль
 * со связанным Telegram, состояние billing и назначения тарифов. Раздел добавляет свои ответы.
 */
export const subscribedMemberRoutes: Readonly<Record<string, RouteResponse>> = {
  "/api/account": () => accountPresentationResponse(),
  "/api/account/billing": () =>
    currentBillingResponse(activeSubscription, {
      grounds: accessGrounds,
      notices: billingNotices,
      payments: ownPayments,
    }),
  "/api/account/billing/enrollments": () => enrollmentsResponse([]),
};
