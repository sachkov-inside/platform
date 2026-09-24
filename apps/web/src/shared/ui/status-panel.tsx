import type { ReactNode } from "react";

/**
 * Карточка состояния страницы: «не найдено», сбой, нет доступа. Один вид у урока, подборки и
 * страниц ошибок приложения; каждая поверхность передаёт свой маркер состояния для проверок.
 */
export function StatusPanel({
  action,
  icon,
  message,
  state,
  title,
}: {
  readonly action: ReactNode;
  readonly icon: ReactNode;
  readonly message: ReactNode;
  readonly state: Readonly<Record<`data-${string}`, string>>;
  readonly title: string;
}) {
  return (
    <section className="max-w-[48rem] pt-1 sm:pt-3" {...state}>
      <div className="relative isolate overflow-clip rounded-2xl bg-secondary px-6 py-7 shadow-card sm:px-8 sm:py-9">
        <span
          aria-hidden="true"
          className="reader-status-halo absolute -right-10 -top-16 size-48 rounded-full bg-accent/15"
        />
        <span className="relative grid size-12 place-items-center rounded-xl bg-background/80 text-accent [&_svg]:size-6">
          {icon}
        </span>
        <h1 className="relative mt-5 max-w-[18ch] text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
          {title}
        </h1>
        <p className="relative mt-4 max-w-[60ch] text-pretty leading-7 text-muted-foreground">
          {message}
        </p>
        <div className="relative mt-7">{action}</div>
      </div>
    </section>
  );
}
