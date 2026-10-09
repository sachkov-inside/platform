"use client";

import { useEffect } from "react";

let holders = 0;

/**
 * Убирает шапку телефона и планшета, пока страница на экране: у витрины курса и покупки свои
 * верхние элементы. Флаг ставит эффект, а не атрибут в разметке: Next.js
 * держит ушедшую страницу в скрытом дереве, и атрибут без фильтра прятал бы шапку и на
 * следующих страницах. Скрытое дерево снимает эффекты, поэтому флаг уходит вместе со страницей.
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
  // Метка в разметке прячет шапку уже в ответе сервера, до гидратации, без сдвига страницы. CSS
  // пропускает метки в скрытых деревьях ушедших страниц: React помечает их `display: none`.
  return <span hidden data-hide-mobile-navigation-marker="" />;
}
