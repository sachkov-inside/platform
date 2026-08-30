import { saveMemberProfileAction } from "@/_pages/account.server";

import type { AccountProfileRuntime } from "../api/resolve-account-profile-runtime";
import { ProfileOnboardingDialog } from "./profile-onboarding-dialog.client";

export function ProfileOnboardingSlot({
  runtime,
}: {
  readonly runtime: AccountProfileRuntime;
}) {
  if (runtime.kind === "unavailable") return <ProfileOnboardingUnavailable />;
  if (runtime.kind !== "authenticated" || runtime.profile !== null) return null;
  return <ProfileOnboardingDialog createAction={saveMemberProfileAction} />;
}

function ProfileOnboardingUnavailable() {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-foreground/45 p-4">
      <section
        aria-describedby="profile-gate-unavailable-description"
        aria-labelledby="profile-gate-unavailable-heading"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-foreground shadow-card sm:p-8"
        role="dialog"
      >
        <h2
          className="text-2xl font-bold tracking-[-0.035em]"
          id="profile-gate-unavailable-heading"
        >
          Не удалось проверить профиль
        </h2>
        <p
          className="mt-3 leading-7 text-muted-foreground"
          id="profile-gate-unavailable-description"
        >
          Продолжить без обязательного профиля нельзя. Обновите страницу или выйдите
          из аккаунта.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <a
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold"
            href=""
          >
            Повторить
          </a>
          <form action="/auth/sign-out" method="post">
            <button
              className="min-h-11 w-full rounded-xl px-4 text-sm font-semibold sm:w-auto"
              type="submit"
            >
              Выйти
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
