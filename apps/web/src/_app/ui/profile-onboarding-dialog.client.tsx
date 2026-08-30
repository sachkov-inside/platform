"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import {
  displayNameLengthIsValid,
  initialProfileMutationState,
  memberProfileTextLength,
  type ProfileMutationState,
} from "@/_pages/account";
import { Button } from "@/shared/ui/button";

type ProfileMutationAction = (
  state: ProfileMutationState,
  formData: FormData,
) => Promise<ProfileMutationState>;

export function ProfileOnboardingDialog({
  createAction,
}: {
  readonly createAction: ProfileMutationAction;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(
    createAction,
    initialProfileMutationState,
  );
  const [displayName, setDisplayName] = useState("");
  const [touched, setTouched] = useState(false);
  const helpId = useId();
  const errorId = useId();
  const length = memberProfileTextLength(displayName.trim());
  const serverError =
    state.kind === "invalid_input" ? state.fieldErrors.displayName : undefined;
  const invalid =
    serverError !== undefined ||
    (touched && !displayNameLengthIsValid(displayName));

  useEffect(() => {
    const current = dialog.current;
    if (current === null) return;
    if (current.open) current.close();
    current.showModal();
  }, []);

  useEffect(() => {
    if (state.kind !== "saved") return;
    dialog.current?.close();
    router.refresh();
  }, [router, state.kind]);

  if (state.kind === "saved") return null;

  return (
    <dialog
      aria-describedby="profile-onboarding-description"
      aria-labelledby="profile-onboarding-heading"
      className="m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border border-border bg-card p-0 text-foreground shadow-card backdrop:bg-foreground/45"
      onCancel={(event) => {
        event.preventDefault();
      }}
      open
      ref={dialog}
    >
      <div className="p-6 sm:p-9">
        <form action={formAction} id="profile-onboarding-form">
          <input name="mode" type="hidden" value="create" />
          <input name="bio" type="hidden" value="" />
          <h2 className="text-balance text-3xl font-bold tracking-[-0.04em]" id="profile-onboarding-heading">
            Как к вам обращаться?
          </h2>
          <p className="mt-3 text-pretty leading-7 text-muted-foreground" id="profile-onboarding-description">
            Создайте короткую подпись для общения внутри сообщества. Это не уникальный
            username — имя можно изменить позже.
          </p>
          <div className="mt-7">
            <label className="text-sm font-semibold" htmlFor="onboarding-display-name">
              Имя
            </label>
            <input
              aria-describedby={`${helpId}${invalid ? ` ${errorId}` : ""}`}
              aria-invalid={invalid || undefined}
              autoComplete="name"
              autoFocus
              className="profile-field mt-2 min-h-12 w-full rounded-xl border border-input bg-background px-4 text-base shadow-sm"
              id="onboarding-display-name"
              maxLength={80}
              minLength={2}
              name="displayName"
              onBlur={() => {
                setTouched(true);
              }}
              onChange={(event) => {
                setDisplayName(event.currentTarget.value);
              }}
              placeholder="Например, Кирилл"
              required
              value={displayName}
            />
            <div className="mt-2 flex justify-between gap-4 text-xs text-muted-foreground">
              <p id={helpId}>От 2 до 80 символов.</p>
              <span aria-label={`${String(length)} из 80 символов`} className="font-mono">
                {length}/80
              </span>
            </div>
            {invalid ? (
              <p className="mt-2 text-sm font-medium text-destructive" id={errorId}>
                {serverError ?? "Укажите имя длиной от 2 до 80 символов."}
              </p>
            ) : null}
          </div>
          {state.kind === "conflict" ? (
            <p className="mt-4 text-sm" role="alert">
              Профиль уже создан в другой вкладке. Обновите страницу.
            </p>
          ) : null}
          {state.kind === "unauthorized" || state.kind === "unavailable" ? (
            <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm" role="alert">
              {state.kind === "unauthorized"
                ? "Сессия завершилась. Войдите снова."
                : "Профиль сейчас не удалось создать. Данные не сохранены — повторите попытку."}
            </p>
          ) : null}
        </form>
        <div className="mt-7 grid gap-3 sm:grid-cols-[1fr_auto]">
          <form action="/auth/sign-out" method="post">
            <Button className="min-h-11 w-full px-4" type="submit" variant="ghost">
              Выйти
            </Button>
          </form>
          <Button
            className="min-h-11 px-5"
            disabled={pending || invalid}
            form="profile-onboarding-form"
            type="submit"
          >
            {pending ? "Создаём…" : "Продолжить"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
