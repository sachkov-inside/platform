import type { ReactNode } from "react";

import "./course-stickers.css";

/**
 * Мини-иллюстрации курса вместо стандартных значков: тёмная плитка с деталями из анимации курса
 * (страница, терминал, путь, агент с модулями). Рисунок не несёт смысла сверх подписи рядом,
 * поэтому скрыт от скринридера.
 */
export type CourseStickerName =
  | "materials"
  | "check"
  | "pace"
  | "questions"
  | "help"
  | "updates"
  | "developer"
  | "engineer"
  | "basics"
  | "telegram";

export function CourseSticker({
  name,
  className,
}: {
  readonly name: CourseStickerName;
  readonly className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`aie-sticker${className === undefined ? "" : ` ${className}`}`}
      data-sticker={name}
      focusable="false"
      viewBox="0 0 40 40"
    >
      {name === "telegram" ? null : (
        <rect className="st-tile" height="40" rx="11" width="40" />
      )}
      {stickers[name]}
    </svg>
  );
}

const stickers: Record<CourseStickerName, ReactNode> = {
  // Гайд со строками и поверх него плеер: гайды, видео и практика.
  materials: (
    <>
      <rect
        className="st-paper"
        height="21"
        rx="3"
        transform="rotate(-8 17 18)"
        width="16"
        x="8"
        y="8"
      />
      <path
        className="st-ink-line"
        d="M12 13.5h8M12.4 17.5h6M12.8 21.5h7"
        transform="rotate(-8 17 18)"
      />
      <circle className="st-accent" cx="27" cy="27" r="7.5" />
      <path className="st-on-accent" d="M25 23.6v6.8l5.6-3.4z" />
    </>
  ),
  // Терминал с прошедшей проверкой.
  check: (
    <>
      <rect className="st-panel" height="21" rx="4" width="28" x="6" y="9" />
      <path className="st-soft-line" d="M10 16l3 2.5-3 2.5M16 21h7" />
      <circle className="st-green" cx="29" cy="28" r="6.5" />
      <path className="st-on-green" d="M26.2 28.1l2 2 3.8-4" />
    </>
  ),
  // Свободный путь без отметок срока: точка идёт в своём темпе.
  pace: (
    <>
      <path className="st-dash" d="M8 30c5-1 6-9 12-10s7-8 12-9" />
      <circle className="st-paper" cx="8" cy="30" r="2.4" />
      <circle className="st-accent aie-sticker-runner" r="3.6" />
      <path className="st-green-stroke" d="M31 8v7" />
      <path className="st-green" d="M31 8h5.5l-1.6 2 1.6 2H31z" />
    </>
  ),
  // Вопрос и ответ автора.
  questions: (
    <>
      <path
        className="st-paper"
        d="M8 10h17a3 3 0 013 3v7a3 3 0 01-3 3H15l-4 3.5V23H8a3 3 0 01-3-3v-7a3 3 0 013-3z"
      />
      <path className="st-ink-line" d="M10 15h13M10 18.5h8" />
      <path
        className="st-accent"
        d="M18 21h14a3 3 0 013 3v5a3 3 0 01-3 3h-2v3l-3.5-3H18a3 3 0 01-3-3v-5a3 3 0 013-3z"
      />
      <path className="st-on-accent-line" d="M20.5 26.5h10" />
    </>
  ),
  // Строка кода с ошибкой и исправление рядом.
  help: (
    <>
      <rect className="st-panel" height="24" rx="4" width="28" x="6" y="8" />
      <rect className="st-red" height="4.5" rx="1.2" width="22" x="9" y="13" />
      <rect
        className="st-green"
        height="4.5"
        rx="1.2"
        width="22"
        x="9"
        y="20"
      />
      <path className="st-soft-line" d="M12 15.25h9M12 22.25h13M12 28h6" />
    </>
  ),
  // Версии курса: новая карточка ложится поверх прежней.
  updates: (
    <>
      <rect
        className="st-panel"
        height="15"
        rx="3.5"
        transform="rotate(-9 17 22)"
        width="20"
        x="7"
        y="15"
      />
      <rect
        className="st-paper"
        height="15"
        rx="3.5"
        width="20"
        x="14"
        y="10"
      />
      <path className="st-ink-line" d="M18 15h8M18 19h11" />
      <circle className="st-accent" cx="31" cy="29" r="5.5" />
      <path
        className="st-on-accent-line"
        d="M31 31.6v-5M28.8 28.6l2.2-2.2 2.2 2.2"
      />
    </>
  ),
  // Редактор с кодом: разработчик.
  developer: (
    <>
      <rect className="st-panel" height="24" rx="4" width="28" x="6" y="8" />
      <circle className="st-accent" cx="10.5" cy="12" r="1.3" />
      <circle className="st-soft" cx="14.5" cy="12" r="1.3" />
      <path
        className="st-accent-line"
        d="M15 19l-4 3.5 4 3.5M25 19l4 3.5-4 3.5"
      />
      <path className="st-paper-line" d="M21.5 18l-3 9" />
    </>
  ),
  // Агент в центре, вокруг модули: собственная AI-система.
  engineer: (
    <>
      <path
        className="st-soft-line"
        d="M20 20L9 10M20 20l11-10M20 20L9 30M20 20l11 10"
      />
      <rect className="st-paper" height="5" rx="1.5" width="8" x="5" y="7.5" />
      <rect className="st-paper" height="5" rx="1.5" width="8" x="27" y="7.5" />
      <rect className="st-paper" height="5" rx="1.5" width="8" x="5" y="27.5" />
      <rect
        className="st-accent"
        height="5"
        rx="1.5"
        width="8"
        x="27"
        y="27.5"
      />
      <circle className="st-tile st-accent-ring" cx="20" cy="20" r="6" />
      <circle className="st-accent" cx="17.6" cy="20" r="1" />
      <circle className="st-accent" cx="20" cy="20" r="1" />
      <circle className="st-accent" cx="22.4" cy="20" r="1" />
    </>
  ),
  // Ветка Git со слиянием: базовые навыки.
  basics: (
    <>
      <path className="st-soft-line" d="M12 9v22M12 15c0 6 16 3 16 10v6" />
      <circle className="st-paper" cx="12" cy="9.5" r="3" />
      <circle className="st-paper" cx="12" cy="30.5" r="3" />
      <circle className="st-accent" cx="28" cy="22" r="3.4" />
      <circle className="st-green" cx="28" cy="30.5" r="3" />
    </>
  ),
  // Знак Telegram: контакт для вопросов.
  telegram: (
    <>
      <circle cx="20" cy="20" fill="#2aabee" r="18" />
      <path
        d="M10.2 19.4l17.6-6.8c.8-.3 1.5.2 1.3 1.4l-3 14.1c-.2 1-.8 1.2-1.6.8l-4.5-3.3-2.2 2.1c-.2.2-.4.4-.9.4l.3-4.6 8.4-7.6c.4-.3-.1-.5-.6-.2l-10.4 6.5-4.5-1.4c-1-.3-1-1 .1-1.4z"
        fill="#fff"
      />
    </>
  ),
};
