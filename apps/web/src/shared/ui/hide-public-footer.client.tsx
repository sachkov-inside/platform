"use client";

import { useEffect } from "react";

let holders = 0;

/**
 * Убирает подвал с документами, пока страница на экране: в прохождении курса, кабинете и
 * закладках он не нужен (решение владельца 09.10.2026). Флаг ставит эффект, а не атрибут в
 * разметке: Next.js держит ушедшую страницу в скрытом дереве, и атрибут прятал бы подвал и на
 * следующих страницах. Скрытое дерево снимает эффекты, поэтому флаг уходит вместе со страницей.
 */
export function HidePublicFooter() {
  useEffect(() => {
    holders += 1;
    document.body.dataset["hidePublicFooter"] = "true";
    return () => {
      holders -= 1;
      if (holders === 0) delete document.body.dataset["hidePublicFooter"];
    };
  }, []);
  return null;
}
