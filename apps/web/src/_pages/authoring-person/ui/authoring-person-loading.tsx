import { AuthoringPersonFrame } from "./authoring-person-frame";
import { PersonCardAnchors } from "./person-card-anchors";

const bar = "admin-skeleton-bar block";

/**
 * Карточка, пока данные идут: возврат, шапка с местом под имя и подпись, кнопка «Выдать продукт»,
 * настоящие якоря разделов и первый блок. Пришедшая карточка не сдвигает ни возврат, ни начало
 * шапки; высота шапки дальше зависит от длины имени и контактов.
 */
export function AuthoringPersonLoading() {
  return (
    <AuthoringPersonFrame busy label="Загрузка карточки человека">
      <div className="grid gap-6" data-person-card-head>
        <header className="person-card-header">
          <div className="grid min-w-0 flex-1 gap-2">
            <span
              aria-hidden="true"
              className={bar}
              style={{ height: "2.1rem", width: "min(22rem, 70%)" }}
            />
            <span
              aria-hidden="true"
              className={bar}
              style={{ height: "1.4rem", width: "min(28rem, 90%)" }}
            />
            <span
              aria-hidden="true"
              className={bar}
              style={{ height: "1.75rem", width: "9rem" }}
            />
          </div>
          <span
            aria-hidden="true"
            className={bar}
            style={{ height: "2.75rem", width: "10.5rem" }}
          />
        </header>
        <PersonCardAnchors />
      </div>
      <div className="grid gap-4" role="status">
        <span className="sr-only">Загружаем карточку человека</span>
        <span
          aria-hidden="true"
          className={bar}
          style={{ height: "1.6rem", width: "12rem" }}
        />
        <span
          aria-hidden="true"
          className={bar}
          style={{ height: "10rem", borderRadius: "16px" }}
        />
        <span
          aria-hidden="true"
          className={bar}
          style={{ height: "10rem", borderRadius: "16px" }}
        />
        <span
          aria-hidden="true"
          className={bar}
          style={{ height: "14rem", borderRadius: "16px" }}
        />
      </div>
    </AuthoringPersonFrame>
  );
}
