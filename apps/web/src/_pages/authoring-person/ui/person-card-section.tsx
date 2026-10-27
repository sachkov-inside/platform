import { CircleAlert, Info } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";

import type { PersonCardSectionId } from "../model/person-card-presentation";

/** Раздел карточки с якорем: заголовок второго уровня и его содержимое. */
export function PersonCardSection({
  children,
  id,
  title,
}: {
  readonly children: ReactNode;
  readonly id: PersonCardSectionId;
  readonly title: string;
}) {
  const headingId = `person-section-${id}`;
  return (
    <section
      aria-labelledby={headingId}
      className="person-card-section"
      id={id}
    >
      <h2 id={headingId}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Блок не прочитался: остальные блоки карточки целы, поэтому сбой говорит только за себя и
 * предлагает перечитать карточку.
 */
export function BlockUnavailable({
  onRetry,
  subject,
}: {
  readonly onRetry: () => void;
  /** Что не загрузилось, в винительном падеже: «Оплаты». */
  readonly subject: string;
}) {
  return (
    <div className="person-card-panel">
      <p className="person-card-note">
        <CircleAlert aria-hidden="true" />
        {subject} сейчас не удалось загрузить. Остальная карточка актуальна.
      </p>
      <div>
        <Button
          className="min-h-11 px-4"
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          Повторить
        </Button>
      </div>
    </div>
  );
}

/** Спокойное пояснение без тревоги: например, у аккаунта нет права на этот блок. */
export function BlockNote({ children }: { readonly children: ReactNode }) {
  return (
    <p className="person-card-note">
      <Info aria-hidden="true" />
      {children}
    </p>
  );
}
