import { ArrowRight } from "lucide-react";
import type { Route } from "next";
import type { ReactNode } from "react";

import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import { CourseFilm } from "./course-film.client";
import { CourseIcon, type CourseIconName } from "./course-icons";

import "./course-hero.css";

/** Иллюстрации пунктов идут по их порядку в описании курса. */
const pointIcons: readonly CourseIconName[] = ["materials", "check", "pace"];

/**
 * Первый экран курса AI Engineering: название с меткой, вводная фраза, пункты, кнопка и анимация.
 * Его показывают и страница курса, и большая карточка Главной, поэтому оба места одинаковы.
 * Весь текст приходит из описания продукта в Inside Content.
 */
export function CourseHero({
  name,
  badge,
  lead,
  highlights,
  action,
  heading = "h1",
  headingId,
  call,
}: {
  readonly name: string;
  readonly badge: string;
  readonly lead: string;
  readonly highlights: readonly string[];
  /** Кнопка первого экрана; страница курса её не показывает, чтобы не уводить со страницы. */
  readonly action?: { readonly href: Route; readonly label: string };
  /** Страница курса — h1, карточка Главной — h2 внутри своей секции. */
  readonly heading?: "h1" | "h2";
  readonly headingId?: string;
  /**
   * Плашка потока и кнопка по этапу продаж вместо обычной кнопки. Страница курса передаёт сюда
   * личную часть, а её запасной вид — ту же обычную кнопку.
   */
  readonly call?: ReactNode;
}) {
  const Heading = heading;
  return (
    <div className="aie-hero">
      <div className="aie-hero-copy">
        <Heading
          className="aie-hero-title"
          data-badge={badge !== ""}
          id={headingId}
        >
          <span className="aie-hero-mark">
            <span className="aie-hero-name">{name}</span>
            {badge === "" ? null : (
              <>
                {" "}
                <span className="aie-hero-badge">{badge}</span>
              </>
            )}
          </span>
        </Heading>
        {lead === "" ? null : <p className="aie-hero-lead">{lead}</p>}
        {highlights.length === 0 ? null : (
          <ul className="aie-hero-points" aria-label="Формат курса">
            {highlights.map((highlight, index) => {
              return (
                <li key={`${String(index)}-${highlight}`}>
                  <CourseIcon name={pointIcons[index] ?? "materials"} />
                  {highlight}
                </li>
              );
            })}
          </ul>
        )}
        {call ??
          (action === undefined ? null : (
            <IntentPrefetchLink className="aie-hero-action" href={action.href}>
              {action.label}
              <ArrowRight aria-hidden="true" />
            </IntentPrefetchLink>
          ))}
      </div>
      <div className="aie-hero-film">
        <CourseFilm />
      </div>
    </div>
  );
}
