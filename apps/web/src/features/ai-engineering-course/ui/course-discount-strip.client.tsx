"use client";

import { ArrowDown, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import type { SaleDiscount } from "@/entities/subscription";

import "./course-discount-strip.css";

const hiddenKey = "course-discount-strip-hidden";
// Без хранилища сеанса крестик помнится до перезагрузки страницы.
const hiddenHere = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readHidden(mark: string): boolean {
  try {
    return window.sessionStorage.getItem(hiddenKey) === mark;
  } catch {
    return hiddenHere.has(mark);
  }
}

function hide(mark: string) {
  try {
    window.sessionStorage.setItem(hiddenKey, mark);
  } catch {
    hiddenHere.add(mark);
  }
  for (const listener of listeners) listener();
}

/**
 * Полоса со скидкой в верхней строке страницы курса, рядом с «← Главная»: идёт скидка, до какого
 * дня, и переход к цене внизу (решение владельца 23.11.2026). Строка всегда одной высоты, поэтому
 * полоса, пришедшая вместе с личной частью страницы, ничего не сдвигает. Крестик скрывает её до
 * конца сеанса браузера, пока не сменится сама скидка.
 */
export function CourseDiscountStrip({
  discount,
  href,
}: {
  readonly discount: SaleDiscount;
  /** Якорь билета с ценой на этой же странице. */
  readonly href: `#${string}`;
}) {
  // Другая скидка — новая полоса: крестик, нажатый на прежней, её не скрывает.
  const mark = `${discount.name}|${discount.percent}|${discount.until ?? ""}`;
  return <Strip key={mark} discount={discount} href={href} mark={mark} />;
}

function Strip({
  discount,
  href,
  mark,
}: {
  readonly discount: SaleDiscount;
  readonly href: `#${string}`;
  /** Отпечаток скидки, под которым запомнен крестик. */
  readonly mark: string;
}) {
  // Сервер не знает, скрыл ли человек полосу: до гидратации она видна, затем крестик помнится.
  // Строка «← Главная» одной высоты с полосой и без неё, поэтому её уход ничего не сдвигает.
  const hidden = useSyncExternalStore(
    subscribe,
    () => readHidden(mark),
    () => false,
  );
  if (hidden) return null;
  return (
    <div className="course-discount-strip" role="region" aria-label="Скидка">
      <a className="course-discount-strip-link" href={href}>
        <span className="course-discount-strip-percent">
          {discount.percent}
        </span>
        <span className="course-discount-strip-text">
          {discount.until === null ? (
            discount.name
          ) : (
            <>
              <span className="course-discount-strip-name">
                {discount.name}{" "}
              </span>
              {discount.until}
            </>
          )}
        </span>
        <span className="course-discount-strip-go">К цене</span>
        <ArrowDown aria-hidden="true" />
      </a>
      <button
        className="course-discount-strip-close"
        type="button"
        aria-label="Скрыть полосу со скидкой"
        onClick={() => {
          hide(mark);
        }}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
