import type { ReactNode } from "react";

/** A preview's own page, such as its contents or a package that does not load. */
export function PreviewNotice({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-[43rem] py-10" data-file-preview-notice>
      <h1 className="text-[1.625rem] font-semibold leading-[1.2] tracking-[-0.025em]">
        {title}
      </h1>
      {children}
    </section>
  );
}
