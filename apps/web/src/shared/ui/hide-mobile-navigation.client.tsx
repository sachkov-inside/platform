"use client";

import { useEffect } from "react";

let holders = 0;

/**
 * Убирает общую нижнюю навигацию телефона и планшета, пока страница на экране: её место занимает
 * своя панель страницы или главное действие. Флаг ставит эффект, а не атрибут в разметке: Next.js
 * держит ушедшую страницу в скрытом дереве, и атрибут прятал бы навигацию и на следующих
 * страницах. Скрытое дерево снимает эффекты, поэтому флаг уходит вместе со страницей.
 */
export function HideMobileNavigation() {
  useEffect(() => {
    holders += 1;
    document.body.dataset["hideMobileNavigation"] = "true";
    return () => {
      holders -= 1;
      if (holders === 0) delete document.body.dataset["hideMobileNavigation"];
    };
  }, []);
  return null;
}
