import {
  ArrowRight,
  BookOpen,
  MessagesSquare,
  ShieldCheck,
} from "lucide-react";
import type { Route } from "next";

import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import { CourseFilm } from "./course-film.client";

import "./course-hero.css";

const pointIcons = [BookOpen, ShieldCheck, MessagesSquare] as const;

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
  compactActionOnPhone = false,
}: {
  readonly name: string;
  readonly badge: string;
  readonly lead: string;
  readonly highlights: readonly string[];
  readonly action: { readonly href: Route; readonly label: string };
  /** Страница курса — h1, карточка Главной — h2 внутри своей секции. */
  readonly heading?: "h1" | "h2";
  readonly headingId?: string;
  /** На телефоне страница курса ведёт в программу нижней панелью, кнопка в первом экране лишняя. */
  readonly compactActionOnPhone?: boolean;
}) {
  const Heading = heading;
  return (
    <div className="aie-hero">
      <div className="aie-hero-copy">
        <Heading className="aie-hero-title" id={headingId}>
          <span className="aie-hero-name">{name}</span>
          {badge === "" ? null : (
            <>
              {" "}
              <span className="aie-hero-badge">{badge}</span>
            </>
          )}
        </Heading>
        {lead === "" ? null : <p className="aie-hero-lead">{lead}</p>}
        {highlights.length === 0 ? null : (
          <ul className="aie-hero-points" aria-label="Формат курса">
            {highlights.map((highlight, index) => {
              const Icon = pointIcons[index] ?? BookOpen;
              return (
                <li key={`${String(index)}-${highlight}`}>
                  <Icon aria-hidden="true" />
                  {highlight}
                </li>
              );
            })}
          </ul>
        )}
        <IntentPrefetchLink
          className="aie-hero-action"
          data-compact-on-phone={compactActionOnPhone}
          href={action.href}
        >
          {action.label}
          <ArrowRight aria-hidden="true" />
        </IntentPrefetchLink>
      </div>
      <div className="aie-hero-film">
        <CourseFilm />
      </div>
    </div>
  );
}
