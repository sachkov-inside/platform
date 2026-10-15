import {hasText} from "../../shared/text.js";
import type { OwnAccess } from "./activation-contract.js";
import type { TelegramButton } from "../outbound/telegram-messages.js";
import type { CommunityAdmission } from "../community/community-provider.js";
export type LearnerProduct = NonNullable<OwnAccess["products"]>[number];
export interface LearnerScreen {
  text: string;
  buttons: readonly TelegramButton[];
}
export const PLATFORM_URL = "https://sachkov.dev";
export const SUPPORT_URL = "https://t.me/sachkova_mng";
const help = (id?: string): TelegramButton => ({
  text: "Помощь",
  callbackData: `access:help${hasText(id) ? `:${id}` : ""}`,
});
const products: TelegramButton = {
  text: "Назад к продуктам",
  callbackData: "access:own",
};
export function productList(
  items: readonly LearnerProduct[],
  author: boolean,
): LearnerScreen {
  return {
    text: items.length > 0
      ? "Мои продукты\n\nВыберите продукт, чтобы открыть материалы или группу."
      : "Мои продукты\n\nПока нет доступных продуктов. Посмотрите продукты на платформе. Если у вас есть ссылка для получения доступа, откройте её.",
    buttons: [
      ...items.map((item) => ({
        text: item.name,
        callbackData: `access:product:${item.id}`,
      })),
      { text: "На платформу", url: PLATFORM_URL },
      help(),
      ...(author ? [{ text: "Управление", callbackData: "author:home" }] : []),
    ],
  };
}
export function courseButton(product: LearnerProduct): TelegramButton[] {
  return product.materials.state === "available" && hasText(product.programmeUrl)
    ? [{ text: "Открыть курс", url: product.programmeUrl }]
    : [];
}
export function productCard(
  product: LearnerProduct,
  admission: CommunityAdmission,
): LearnerScreen {
  const restricted = admission.kind === "moderation_blocked";
  const material =
    product.materials.state === "available"
      ? "Материалы доступны"
      : product.materials.state === "expired"
        ? "Доступ к материалам завершён"
        : product.materials.state === "revoked"
          ? "Доступ к материалам отозван"
          : "Не удалось проверить доступ к материалам";
  const community = restricted
    ? "Вступление в группу ограничено"
    : admission.kind === "member"
      ? "Вы уже в группе курса"
      : product.community.state === "available"
        ? "Вы можете вступить в группу курса"
        : product.community.state === "expired"
          ? "Доступ к группе завершён"
          : product.community.state === "revoked"
            ? "Доступ к группе отозван"
            : "Не удалось проверить доступ к группе";
  return {
    text: `${product.name}\n\n${material}. ${community}.`,
    buttons: [
      ...courseButton(product),
      ...(product.community.state === "available" &&
      !restricted &&
      admission.kind !== "member"
        ? [
            {
              text: "Вступить в группу",
              callbackData: `access:community:${product.id}`,
            },
          ]
        : []),
      help(product.id),
      products,
    ],
  };
}
export function helpScreen(
  topic: string,
  id?: string,
  programmeUrl?: string,
  continuationUrl?: string,
  returnAction?:string,
): LearnerScreen {
  const back: TelegramButton = {
    text: "Назад",
    callbackData: `access:help${hasText(id) ? `:${id}` : ""}`,
  };
  const support: TelegramButton = {
    text: "Написать в поддержку",
    url: SUPPORT_URL,
  };
  const account: TelegramButton = {
    text: "Открыть аккаунт",
    url: `${PLATFORM_URL}/account`,
  };
  const selected: TelegramButton = hasText(id)
    ? { text: "Открыть продукт", callbackData: returnAction ?? `access:product:${id}` }
    : { text: "Мои продукты", callbackData: "access:own" };
  if (topic === "help_missing")
    return {
      text: "Проверьте, что вошли в аккаунт, в котором получали доступ, и подключили к нему Telegram. Если у вас есть ссылка для получения доступа, откройте её в боте.",
      buttons: [account, support, back],
    };
  if (topic === "help_group")
    return {
      text: "Откройте продукт в боте и нажмите кнопку входа в группу. Если бот сообщает об ограничении, напишите в поддержку.",
      buttons: [selected, support, back],
    };
  if (topic === "help_signin")
    return {
      text: "Начните вход на платформе ещё раз. Если раньше входили по почте, используйте ту же почту. Подтвердите вход в том же браузере, где начали его.",
      buttons: [
        {
          text: "Войти на платформу",
          url: continuationUrl ?? `${PLATFORM_URL}/auth/sign-in?returnTo=${encodeURIComponent(hasText(programmeUrl) ? new URL(programmeUrl).pathname : "/account/access")}`,
        },
        support,
        back,
      ],
    };
  return {
    text: "Помощь\n\nВыберите, с чем нужна помощь.",
    buttons: [
      {
        text: "Не вижу продукт",
        callbackData: `access:help_missing${hasText(id) ? `:${id}` : ""}`,
      },
      {
        text: "Не могу вступить в группу",
        callbackData: `access:help_group${hasText(id) ? `:${id}` : ""}`,
      },
      {
        text: "Не могу войти",
        callbackData: `access:help_signin${hasText(id) ? `:${id}` : ""}`,
      },
      support,
      hasText(id)
        ? { text: "Назад к продукту", callbackData: returnAction ?? `access:product:${id}` }
        : { text: "Назад", callbackData: "access:own" },
    ],
  };
}
