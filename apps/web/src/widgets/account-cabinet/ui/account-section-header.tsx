import {
  accountSectionById,
  type AccountSectionId,
} from "../model/account-sections";

/** Заголовок раздела берёт название и задачу из того же списка, что и навигация. */
export function AccountSectionHeader({
  section,
}: {
  readonly section: AccountSectionId;
}) {
  const { label, summary } = accountSectionById[section];
  return (
    <header className="mb-8 border-b border-border pb-7">
      <h1 className="text-balance text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
        {label}
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{summary}</p>
    </header>
  );
}
