import type { ReactNode } from "react";

import { underageNotice } from "../model/acceptance";

/**
 * Строка под кнопкой, которая принимает условия: что именно человек принимает её нажатием. Отметок
 * нет — принятие и есть нажатие, и журнал записывает подпись кнопки рядом с этой строкой.
 */
export function AcceptanceNote({
  children,
  className,
  underage = false,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  /** Покупке нужна строка о законном представителе; возобновлению уже оформленной подписки — нет. */
  readonly underage?: boolean;
}) {
  return (
    <div className={className}>
      <p className="text-sm leading-6 text-muted-foreground">{children}</p>
      {underage ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{underageNotice}</p>
      ) : null}
    </div>
  );
}
