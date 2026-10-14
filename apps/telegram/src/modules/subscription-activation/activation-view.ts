import { isProductCapability } from "@inside/access-capabilities";
import { hasText } from "../../shared/text.js";
import { isTruthy } from "../../shared/truthiness.js";
import type {
  OwnAccess,
  ActivationResult,
  ActivationResponse,
} from "./activation-contract.js";
import type { TelegramButton } from "../outbound/telegram-messages.js";
const enrollmentStates = {
  active: "Действует",
  scheduled: "Начнётся позже",
  expired: "Срок завершён",
  revoked: "Отозвано",
  pending_verification:
    "Ожидает подтверждения Tribute. Временный доступ по этому основанию не подтверждён. Повторите проверку позже или нажмите «Помощь»",
  suspended_source:
    "Источник Tribute завершён, доступ по нему приостановлен. Обратитесь к владельцу для подтверждения нового периода. Повторная проверка и вступление в группу не восстанавливают это основание",
};
/** A course student outside the course group gets access through the author's personal invitation. */
const OUTSIDE_COURSE_GROUP =
  "Если вы учились на курсе, но вас нет в его группе, напишите автору.";
/** Tells the person that an unconfirmed ground is now in the owner's review queue. */
export const OWNER_REVIEW = "Запрос передан автору курса.";
export function activationMenu(
  accountUrl: string,
  result?: ActivationResult<ActivationResponse>,
  code?: string,
): readonly TelegramButton[] {
  if (result?.ok && ["active", "already_active"].includes(result.value.state)) {
    return [
      { text: "Открыть платформу", url: accountUrl },
      ...(result.value.enrollment?.tier.benefits.includes("community")
        ? [{ text: "Чат курса", callbackData: "access:community" }]
        : []),
    ];
  }
  const help: TelegramButton = { text: "Помощь", callbackData: "access:help" };
  if (
    result &&
    !result.ok &&
    ["policy_paused", "not_found", "identity_conflict"].includes(
      result.error.code,
    )
  )
    return [help];
  return [
    {
      text: "Проверить ещё раз",
      callbackData:
        code === undefined ? "access:retry" : `access:retry:${code}`,
    },
    help,
  ];
}
export function accountPrompt(
  accountUrl: string,
  code?: string,
): {
  text: string;
  buttons: readonly TelegramButton[];
} {
  return {
    text: "Чтобы открыть курс, войдите на платформу и привяжите Telegram в аккаунте.",
    buttons: [
      { text: "Войти на платформу", url: accountUrl },
      {
        text: "Проверить доступ",
        callbackData:
          code === undefined ? "access:retry" : `access:retry:${code}`,
      },
    ],
  };
}
/** The answer already sends a course student outside the group to the author; no second instruction. */
export function asksToWriteAuthor(
  result: ActivationResult<ActivationResponse>,
): boolean {
  return result.ok
    ? result.value.state === "rejected"
    : result.error.code === "source_not_confirmed";
}
export function activationMessage(
  result: ActivationResult<ActivationResponse>,
): string {
  if (!result.ok) {
    const messages: Partial<Record<string, string>> = {
      policy_paused:
        "Активация по этой ссылке приостановлена. Напишите автору курса.",
      identity_conflict:
        "Не удалось связать Telegram с аккаунтом. Напишите автору курса.",
      source_not_confirmed: `Доступ пока не подтверждён.\n\n${OUTSIDE_COURSE_GROUP}`,
      not_found:
        "Ссылка активации не найдена. Попросите новую ссылку у автора курса.",
      revision_conflict:
        "Условия доступа обновились. Нажмите «Проверить ещё раз».",
    };
    return (
      messages[result.error.code] ??
      "Не удалось проверить доступ.\n\nПопробуйте ещё раз чуть позже."
    );
  }
  switch (result.value.state) {
    case "active":
    case "already_active": {
      const heading =
        result.value.state === "active"
          ? "Доступ к курсу открыт"
          : "Доступ к курсу уже открыт";
      const name = result.value.enrollment?.tier.name;
      return `${heading}\n\n${hasText(name) ? `${name}\n` : ""}Материалы доступны на платформе.`;
    }
    case "pending_review":
      if (result.value.enrollment && result.value.enrollment.state !== "active")
        return `Доступ пока не подтверждён.\n\n${result.value.enrollment.tier.name}: ${enrollmentStates[result.value.enrollment.state]}.`;
      return "Доступ пока не подтверждён.";
    case "rejected":
      return `Доступ пока не подтверждён.\n\n${OUTSIDE_COURSE_GROUP}`;
    case "checking":
      return "Проверяем доступ к курсу…";
    case "needs_account":
      return "Войдите на платформу и привяжите Telegram в аккаунте.";
    case "unavailable":
      return "Не удалось проверить доступ.\n\nПопробуйте ещё раз чуть позже.";
  }
}
export function ownAccessText(access: OwnAccess): string {
  const origin = {
    course: "Предоставлено за курс",
    tribute: "Оплачено через Tribute",
    manual: "Назначено владельцем",
    platform_payment: "Оформлено на Platform",
  };

  const rows = access.enrollments
    .slice(0, 8)
    .map(
      (e) =>
        `${e.tier.name}\n${origin[e.origin]}. ${enrollmentStates[e.state]}.\nСостав: ${e.tier.benefits.map(capability).join(", ")}.\nНачало: ${date(e.startsAt)}. ${term(e.endsAt)} — срок назначения. ${(e.benefitTerms ?? []).map((t) => `${capability(t.capability)}: ${t.revoked ? "отозвано" : term(t.endsAt)}`).join("; ")}.${e.renewal === "not_applicable" ? " Списаний Inside нет." : " Продление — по вашему платёжному соглашению."}`,
    );
  for (const ground of access.grounds.filter((g) => g.active).slice(0, 8))
    rows.push(
      `Действующее основание: ${ground.source === "paid" ? "покупка" : ground.source === "manual" ? "назначение владельца" : "прежний доступ"}. ${term(ground.validUntil)}. Состав: ${ground.capabilities.map(capability).join(", ")}.`,
    );
  if (!isTruthy(rows.length))
    rows.push(
      "Действующие права не найдены. Кабинет и история доступны; это не мешает обратиться за подтверждением прежней покупки.",
    );
  const admission =
    access.admission.admissionRestriction === "moderation" ||
    access.admission.admissionRestriction === "external_unknown" ||
    access.admission.state === "moderation_blocked"
      ? "Вступление ограничено. Обратитесь к владельцу; доступ к материалам не снимается этим запретом."
      : access.admission.state === "ready"
        ? "Право на сообщество действует. Запросите вступление отдельной кнопкой."
        : access.admission.state === "checking"
          ? "Состояние сообщества уточняется."
          : "Сейчас нет действующего права на сообщество.";
  const footer =
    "Срок каждого отдельного права, полный состав и история — в кабинете.";
  const heading = `Мои доступы\n\n${admission}\n\n`;
  const details = rows.join("\n\n");
  const room = 3900 - heading.length - footer.length - 3;
  return `${heading}${details.length > room ? details.slice(0, room - 1) + "…" : details}\n\n${footer}`;
}
function date(value: string): string {
  return (
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value)) + " МСК"
  );
}
function term(value: string | null): string {
  return value === null ? "Без даты окончания" : `До ${date(value)}`;
}
function capability(value: string): string {
  return (
    (
      {
        materials: "материалы",
        community: "сообщество",
        support: "поддержка",
        reviews: "ревью",
      } as Record<string, string>
    )[value] ??
    (isProductCapability(value) ? "купленный продукт" : "состав в кабинете")
  );
}
