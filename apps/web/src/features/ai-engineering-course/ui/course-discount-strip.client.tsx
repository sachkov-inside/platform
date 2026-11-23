"use client";

import { ArrowDown, X } from "lucide-react";
import { useState } from "react";

import type { SaleDiscount } from "@/entities/subscription";
import { ApplicationAnnouncement } from "@/shared/ui/application-announcement.client";

import "./course-discount-strip.css";

const hiddenKey = "course-discount-strip-hidden";

function readHidden(mark: string): boolean {
  try {
    return window.sessionStorage.getItem(hiddenKey) === mark;
  } catch {
    return false;
  }
}

/**
 * Короткая полоса над страницей курса: идёт скидка, до какого дня, и переход к цене внизу
 * (решение владельца 23.11.2026). Крестик скрывает её до конца сеанса браузера, пока не сменится
 * сама скидка.
 */
export function CourseDiscountStrip({
  discount,
  href,
}: {
  readonly discount: SaleDiscount;
  /** Якорь билета с ценой на этой же странице. */
  readonly href: `#${string}`;
}) {
  return (
    <ApplicationAnnouncement>
      <Strip discount={discount} href={href} />
    </ApplicationAnnouncement>
  );
}

function Strip({
  discount,
  href,
}: {
  readonly discount: SaleDiscount;
  readonly href: `#${string}`;
}) {
  const mark = `${discount.name}|${discount.percent}|${discount.until ?? ""}`;
  // Полоса рисуется только в браузере, после того как нашла место над шапкой.
  const [hidden, setHidden] = useState(() => readHidden(mark));
  if (hidden) return null;
  return (
    <div className="course-discount-strip" role="region" aria-label="Скидка">
      <span className="course-discount-strip-percent">{discount.percent}</span>
      <p className="course-discount-strip-text">
        {discount.until === null ? (
          discount.name
        ) : (
          <>
            <span className="course-discount-strip-name">{discount.name} </span>
            {discount.until}
          </>
        )}
      </p>
      <a className="course-discount-strip-link" href={href}>
        К цене
        <ArrowDown aria-hidden="true" />
      </a>
      <button
        className="course-discount-strip-close"
        type="button"
        aria-label="Скрыть полосу со скидкой"
        onClick={() => {
          setHidden(true);
          try {
            window.sessionStorage.setItem(hiddenKey, mark);
          } catch {
            // Хранилище закрыто: полоса скрыта до перезагрузки страницы.
          }
        }}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
