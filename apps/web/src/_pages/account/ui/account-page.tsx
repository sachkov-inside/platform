export function AccountSignInRequired() {
  return (
    <section className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-4xl font-bold tracking-[-0.04em]">Войдите в аккаунт</h1>
      <p className="mt-4 text-muted-foreground">
        Профиль и его настройки доступны только владельцу аккаунта.
      </p>
      <form action="/auth/sign-in" className="mt-7" method="post">
        <button className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground" type="submit">
          Войти по email
        </button>
      </form>
    </section>
  );
}

export function AccountUnavailable({ reference }: { readonly reference: string }) {
  return (
    <section className="mx-auto max-w-xl py-16">
      <h1 className="text-4xl font-bold tracking-[-0.04em]">Профиль временно недоступен</h1>
      <p className="mt-4 text-muted-foreground">
        Данные не менялись. Обновите страницу или повторите попытку позже.
      </p>
      <p className="mt-5 font-mono text-xs text-muted-foreground">Код: {reference}</p>
    </section>
  );
}
