"use client";

import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
  displayNameLengthIsValid,
  type PrivateMemberProfile,
} from "@/entities/member-profile";
import { Button } from "@/shared/ui/button";
import { createMemberProfile } from "../api/create-member-profile.browser";
import { updateMemberProfile } from "../api/update-member-profile.browser";

export function MemberProfileEditor({
  initialProfile,
  suggestedName,
  onSaved,
}: {
  readonly initialProfile: PrivateMemberProfile | null;
  readonly suggestedName: string | null;
  readonly onSaved: (profile: PrivateMemberProfile) => void;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [name, setName] = useState(initialProfile?.displayName ?? "");
  const id = useId();
  const save = useMutation({
    mutationFn: () =>
      profile === null
        ? createMemberProfile({ displayName: name, bio: "" })
        : updateMemberProfile({
            displayName: name,
            bio: profile.bio ?? "",
            expectedVersion: profile.version,
          }),
    retry: false,
    onSuccess: (result) => {
      if (result.kind !== "saved") return;
      setProfile(result.profile);
      setName(result.profile.displayName);
      onSaved(result.profile);
    },
  });
  const result = save.data;
  const error = save.isError
    ? "Не удалось сохранить имя. Попробуйте ещё раз."
    : result?.kind === "invalid_input"
      ? result.fieldErrors.displayName
      : result?.kind === "unauthorized"
        ? "Сессия завершилась. Войдите снова."
        : result?.kind === "unavailable"
          ? "Не удалось сохранить имя. Попробуйте ещё раз."
          : undefined;
  const conflict = result?.kind === "conflict";
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="border-b border-border py-6"
    >
      <h2 className="text-lg font-semibold" id={`${id}-heading`}>
        Профиль
      </h2>
      <form
        className="mt-4 max-w-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (displayNameLengthIsValid(name)) save.mutate();
        }}
      >
        <label className="text-sm font-medium" htmlFor={id}>
          Отображаемое имя
        </label>
        <p className="mt-1 text-sm text-muted-foreground" id={`${id}-help`}>
          Как к вам обращаться. От 2 до 80 символов, имя может повторяться.
        </p>
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <input
            aria-describedby={`${id}-help${error === undefined ? "" : ` ${id}-error`}`}
            aria-invalid={error !== undefined || undefined}
            disabled={save.isPending}
            autoComplete="nickname"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-base"
            id={id}
            name="displayName"
            onChange={(event) => {
              setName(event.currentTarget.value);
              save.reset();
            }}
            placeholder={suggestedName ?? "Как к вам обращаться"}
            required
            value={name}
          />
          <Button
            className="min-h-11"
            disabled={
              save.isPending ||
              conflict ||
              !displayNameLengthIsValid(name) ||
              name.trim() === profile?.displayName
            }
            type="submit"
          >
            {save.isPending ? "Сохраняем…" : "Сохранить имя"}
          </Button>
        </div>
        {error === undefined ? null : (
          <p
            className="mt-3 text-sm text-destructive"
            id={`${id}-error`}
            role="alert"
          >
            {error}
          </p>
        )}
        {conflict ? (
          <p className="mt-3 text-sm" role="alert">
            Имя изменилось в другой вкладке.{" "}
            <button
              className="underline underline-offset-4"
              onClick={() => {
                window.location.reload();
              }}
              type="button"
            >
              Обновить страницу
            </button>
          </p>
        ) : null}
        {result?.kind === "saved" ? (
          <p className="mt-3 text-sm" role="status">
            Имя сохранено.
          </p>
        ) : null}
      </form>
    </section>
  );
}
