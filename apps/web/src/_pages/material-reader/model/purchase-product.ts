import type { Route } from "next";

import type { PurchaseInvitation } from "@/shared/routing/subscription-route";

/**
 * Какой продукт продаёт закрытый материал, открытый без пути руководства. Закрытое живёт внутри
 * продуктов, поэтому призыв ведёт к продукту, в который материал входит. Если продаются два
 * продукта с этим материалом, выбор был бы наугад: призыва к продукту нет, как и без продаваемого.
 */
export function soleSoldProduct(
  products: readonly { readonly slug: string; readonly sold: boolean }[],
): string | undefined {
  const sold = products.filter((product) => product.sold);
  return sold.length === 1 ? sold[0]?.slug : undefined;
}

/** Куда урок курса ведёт того, кому курс ещё не открыт. */
export type CourseLessonAction =
  | { readonly kind: "purchase"; readonly href: Route }
  | { readonly kind: "course"; readonly href: Route };

/**
 * Из бесплатного и закрытого урока курса человек идёт сразу к оплате (решение владельца
 * 29.10.2026, #1647). Пока курс не продаётся, оплата была бы тупиком, поэтому кнопка ведёт на
 * страницу курса: там набор и список ожидания.
 */
export function courseLessonAction({
  invitation,
  courseHref,
}: {
  readonly invitation: PurchaseInvitation | null;
  readonly courseHref: Route;
}): CourseLessonAction {
  return invitation?.kind === "product"
    ? { kind: "purchase", href: invitation.href }
    : { kind: "course", href: courseHref };
}

/** Призыв в конце бесплатного урока и закрытый шаг, который идёт следом. */
export interface FreeLessonCall {
  readonly action: CourseLessonAction;
  /** Название следующего шага, если он закрыт этому читателю. */
  readonly lockedNext: string | null;
}

/**
 * Призыв в конце бесплатного урока курса. Гостя бесплатный урок зовёт войти через Telegram, а не
 * платить (решение владельца 29.10.2026, #1825). Тому, кому курс открыт, звать некуда; без ответа о
 * доступе призыв тоже молчит, чтобы не предложить покупку тому, кто курс уже купил. Следующий шаг
 * назван закрытым по составу программы: раз курс читателю не открыт, закрытое в нём закрыто и ему.
 */
export function freeLessonCall({
  signedIn,
  access,
  invitation,
  courseHref,
  next,
}: {
  readonly signedIn: boolean;
  readonly access: "open" | "closed" | "unknown";
  readonly invitation: PurchaseInvitation | null;
  readonly courseHref: Route;
  readonly next: {
    readonly title: string;
    readonly availability: "available" | "locked" | "unavailable";
  } | null;
}): FreeLessonCall | null {
  if (!signedIn || access !== "closed") return null;
  return {
    action: courseLessonAction({ invitation, courseHref }),
    lockedNext: next?.availability === "locked" ? next.title : null,
  };
}
