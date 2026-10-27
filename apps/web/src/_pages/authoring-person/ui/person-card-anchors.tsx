import { personCardSections } from "../model/person-card-presentation";

/**
 * Якоря разделов карточки (решение владельца 10). Ссылки обычные `#id`: работают и пока карточка
 * загружается, и без JavaScript, и не добавляют записей сверх перехода к разделу.
 */
export function PersonCardAnchors() {
  return (
    <nav aria-label="Разделы карточки" className="person-card-anchors">
      {personCardSections.map((section) => (
        <a href={`#${section.id}`} key={section.id}>
          {section.label}
        </a>
      ))}
    </nav>
  );
}
