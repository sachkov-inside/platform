import type { ReactNode } from "react";

/** Выделенная ключевая мысль: одна строка урока, которую читатель должен унести. */
export function MaterialKeyPoint({ children }: { readonly children: ReactNode }) {
  return (
    <p
      className="mt-8 border-l-4 border-accent py-1 pl-5 text-lg font-semibold leading-[1.5] text-foreground md:text-xl"
      data-material-block="keyPoint"
    >
      {children}
    </p>
  );
}
