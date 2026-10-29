import { describe, expect, it } from "vitest";

import {
  courseLessonAction,
  freeLessonCall,
} from "@/_pages/material-reader/model/purchase-product";
import { internalRoute } from "@/shared/routing/internal-route";

const courseHref = internalRoute("/products/ai-engineering");
const buyHref = internalRoute("/products/ai-engineering/buy");
const sold = { kind: "product", href: buyHref } as const;
const lockedNext = {
  title: "Первая версия продукта",
  access: "closed",
} as const;
// Бесплатный шаг остаётся открытым, даже если читателю без Telegram он пока недоступен (#1825).
const freeNext = {
  title: "Начинаем работу с агентом в проекте",
  access: "free",
} as const;

describe("урок курса ведёт того, кому курс не открыт", () => {
  it("на оплату, пока курс продаётся", () => {
    expect(courseLessonAction({ invitation: sold, courseHref })).toEqual({
      kind: "purchase",
      href: buyHref,
    });
  });

  it("на страницу курса, когда купить нельзя: оплата была бы тупиком", () => {
    expect(courseLessonAction({ invitation: null, courseHref })).toEqual({
      kind: "course",
      href: courseHref,
    });
  });
});

describe("призыв в конце бесплатного урока", () => {
  it("зовёт на оплату и называет закрытый следующий шаг", () => {
    expect(
      freeLessonCall({
        signedIn: true,
        access: "closed",
        invitation: sold,
        courseHref,
        next: lockedNext,
      }),
    ).toEqual({
      action: { kind: "purchase", href: buyHref },
      lockedNext: "Первая версия продукта",
    });
  });

  it("не называет закрытым шаг, который открыт, и шаг, которого нет", () => {
    expect(
      freeLessonCall({
        signedIn: true,
        access: "closed",
        invitation: sold,
        courseHref,
        next: freeNext,
      })?.lockedNext,
    ).toBeNull();
    expect(
      freeLessonCall({
        signedIn: true,
        access: "closed",
        invitation: sold,
        courseHref,
        next: null,
      })?.lockedNext,
    ).toBeNull();
  });

  it("без продажи ведёт на страницу курса", () => {
    expect(
      freeLessonCall({
        signedIn: true,
        access: "closed",
        invitation: null,
        courseHref,
        next: lockedNext,
      })?.action,
    ).toEqual({ kind: "course", href: courseHref });
  });

  it("молчит, когда курс уже открыт или доступ не удалось проверить", () => {
    for (const access of ["open", "unknown"] as const)
      expect(
        freeLessonCall({
          signedIn: true,
          access,
          invitation: sold,
          courseHref,
          next: lockedNext,
        }),
      ).toBeNull();
  });

  it("гостю не предлагает оплату: ему бесплатный урок открывает вход (#1825)", () => {
    expect(
      freeLessonCall({
        signedIn: false,
        access: "closed",
        invitation: sold,
        courseHref,
        next: lockedNext,
      }),
    ).toBeNull();
  });
});
