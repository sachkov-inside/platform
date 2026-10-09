import "./start-countdown-badge.css";

/**
 * Наклейка на углу карточки с ценой: сколько дней до старта потока. Дату словами она не пишет —
 * число дней читается быстрее (решение владельца 09.10.2026). Карточке нужен `position: relative`
 * и видимое переполнение; наклейка выходит за её верхний край.
 */
export function StartCountdownBadge({ text }: { readonly text: string }) {
  return <span className="start-countdown-badge">{text}</span>;
}
