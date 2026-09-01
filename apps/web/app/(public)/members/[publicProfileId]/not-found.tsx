export default function PublicMemberProfileNotFound() {
  return (
    <section className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-balance text-4xl font-bold tracking-[-0.04em]">
        Профиль недоступен
      </h1>
      <p className="mt-4 text-pretty text-muted-foreground">
        Такой страницы нет или у текущего участника нет доступа к ней.
      </p>
    </section>
  );
}
