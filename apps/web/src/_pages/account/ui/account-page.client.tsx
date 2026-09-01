"use client";

import { Check, Copy, RotateCcw } from "lucide-react";
import { useActionState, useCallback, useId, useState } from "react";

import { Button } from "@/shared/ui/button";

import {
  initialProfileMutationState,
  type PrivateMemberProfile,
  type ProfileMutationState,
} from "../model/member-profile";
import {
  bioLengthIsValid,
  displayNameLengthIsValid,
  memberProfileTextLength,
} from "../model/profile-fields";
import { MemberProfileProjection } from "./member-profile-projection";

type ProfileMutationAction = (
  state: ProfileMutationState,
  formData: FormData,
) => Promise<ProfileMutationState>;

interface AccountPageClientProps {
  readonly initialProfile: PrivateMemberProfile | null;
  readonly onProfileChange?: (profile: PrivateMemberProfile) => void;
  readonly saveAction: ProfileMutationAction;
}

export function AccountPageClient({
  initialProfile,
  onProfileChange,
  saveAction,
}: AccountPageClientProps) {
  const [profile, setProfile] = useState(initialProfile);
  const [displayName, setDisplayName] = useState(initialProfile?.displayName ?? "");
  const [bio, setBio] = useState(initialProfile?.bio ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const [bioTouched, setBioTouched] = useState(false);
  const [copied, setCopied] = useState(false);
  const nameHelpId = useId();
  const nameErrorId = useId();
  const bioHelpId = useId();
  const bioErrorId = useId();
  const acceptSave = useCallback(
    async (state: ProfileMutationState, formData: FormData) => {
      const result = await saveAction(state, formData);
      if (result.kind === "saved") {
        setDisplayName(result.profile.displayName);
        setBio(result.profile.bio ?? "");
        setNameTouched(false);
        setBioTouched(false);
        setProfile(result.profile);
        onProfileChange?.(result.profile);
      }
      return result;
    },
    [onProfileChange, saveAction],
  );
  const [saveState, saveFormAction, savePending] = useActionState(
    acceptSave,
    initialProfileMutationState,
  );
  const nameLength = memberProfileTextLength(displayName.trim());
  const bioLength = memberProfileTextLength(bio);
  const serverNameError =
    saveState.kind === "invalid_input"
      ? saveState.fieldErrors.displayName
      : undefined;
  const serverBioError =
    saveState.kind === "invalid_input" ? saveState.fieldErrors.bio : undefined;
  const nameInvalid =
    serverNameError !== undefined ||
    (nameTouched && !displayNameLengthIsValid(displayName));
  const bioInvalid =
    serverBioError !== undefined || (bioTouched && !bioLengthIsValid(bio));
  const fieldsAreValid =
    displayNameLengthIsValid(displayName) && bioLengthIsValid(bio);
  const fieldsAreDirty =
    profile === null ||
    displayName.trim() !== profile.displayName ||
    emptyToNull(bio) !== profile.bio;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
          Ваш профиль
        </h1>
        <form action="/auth/sign-out" method="post">
          <Button className="min-h-11 px-4" type="submit" variant="outline">
            Выйти из аккаунта
          </Button>
        </form>
      </header>

      <form action={saveFormAction} className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <section aria-labelledby="profile-editor-heading" className="min-w-0">
          <div className="mb-7 flex items-start justify-between gap-4">
            <div>
              <h2
                aria-label="Редактирование"
                className="text-2xl font-bold tracking-[-0.035em]"
                id="profile-editor-heading"
              >
                Редактирование
              </h2>
              <p className="mt-1 text-sm font-medium text-muted-foreground">Только вы</p>
            </div>
            <Button
              className="min-h-11 px-4"
              disabled={savePending || nameInvalid || bioInvalid || !fieldsAreValid || !fieldsAreDirty}
              type="submit"
            >
              {savePending ? "Сохраняем…" : profile === null ? "Создать" : "Сохранить"}
            </Button>
          </div>

          <input name="mode" type="hidden" value={profile === null ? "create" : "update"} />
          {profile === null ? null : (
            <input name="expectedVersion" type="hidden" value={profile.version} />
          )}
          <div className="grid gap-7">
            <div>
              <label className="text-sm font-semibold" htmlFor="profile-display-name">
                Имя
              </label>
              <input
                aria-describedby={`${nameHelpId}${nameInvalid ? ` ${nameErrorId}` : ""}`}
                aria-invalid={nameInvalid || undefined}
                className="profile-field mt-2 min-h-12 w-full rounded-xl border border-input bg-background px-4 text-base shadow-sm transition-colors placeholder:text-muted-foreground/65 focus:border-ring"
                id="profile-display-name"
                name="displayName"
                onBlur={() => {
                  setNameTouched(true);
                }}
                onChange={(event) => {
                  setDisplayName(event.currentTarget.value);
                }}
                placeholder="Как к вам обращаться"
                required
                value={displayName}
              />
              <div className="mt-2 flex justify-between gap-4 text-xs text-muted-foreground">
                <p id={nameHelpId}>От 2 до 80 символов, уникальность не требуется.</p>
                <span aria-label={`${String(nameLength)} из 80 символов`} className="font-mono">
                  {nameLength}/80
                </span>
              </div>
              {nameInvalid ? (
                <p className="mt-2 text-sm font-medium text-destructive" id={nameErrorId}>
                  {serverNameError ?? "Укажите имя длиной от 2 до 80 символов."}
                </p>
              ) : null}
            </div>

            <div>
              <label className="text-sm font-semibold" htmlFor="profile-bio">
                О себе <span className="font-normal text-muted-foreground">· необязательно</span>
              </label>
              <textarea
                aria-describedby={`${bioHelpId}${bioInvalid ? ` ${bioErrorId}` : ""}`}
                aria-invalid={bioInvalid || undefined}
                className="profile-field mt-2 min-h-40 w-full resize-y rounded-xl border border-input bg-background px-4 py-3 text-base leading-7 shadow-sm transition-colors placeholder:text-muted-foreground/65 focus:border-ring"
                id="profile-bio"
                name="bio"
                onBlur={() => {
                  setBioTouched(true);
                }}
                onChange={(event) => {
                  setBio(event.currentTarget.value);
                }}
                placeholder="Чем занимаетесь, что изучаете, чем можете быть полезны"
                value={bio}
              />
              <div className="mt-2 flex justify-between gap-4 text-xs text-muted-foreground">
                <p id={bioHelpId}>Короткий текст, который увидят участники.</p>
                <span aria-label={`${String(bioLength)} из 500 символов`} className="font-mono">
                  {bioLength}/500
                </span>
              </div>
              {bioInvalid ? (
                <p className="mt-2 text-sm font-medium text-destructive" id={bioErrorId}>
                  {serverBioError ?? "Описание должно быть не длиннее 500 символов."}
                </p>
              ) : null}
            </div>
          </div>

          <MutationNotice state={saveState} />
        </section>

        <section aria-labelledby="profile-preview-heading" className="min-w-0 border-t border-border pt-7 lg:border-t-0 lg:pt-0">
          <div className="mb-7">
            <h2
              aria-label="Профиль участника"
              className="text-2xl font-bold tracking-[-0.035em]"
              id="profile-preview-heading"
            >
              Профиль участника
            </h2>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              {profile === null ? "Появится после создания" : "Видят участники"}
            </p>
          </div>
          {profile?.status === "disabled" ? (
            <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm">
              <p className="font-semibold">Профиль скрыт модерацией</p>
              <p className="mt-1 text-muted-foreground">
                Другие участники получают безопасную страницу 404. Поля можно исправить;
                восстановление выполняет владелец платформы.
              </p>
            </div>
          ) : null}
          <MemberProfileProjection
            fields={
              profile === null
                ? { bio: null, displayName: "" }
                : { bio: profile.bio, displayName: profile.displayName }
            }
          />
          {profile === null ? (
            <p className="mt-4 text-sm text-muted-foreground">
              После создания профиль получит постоянную ссылку для участников.
            </p>
          ) : (
            <ProfileLink
              copied={copied}
              onCopy={() => {
                const url = `${window.location.origin}/members/${profile.publicProfileId}`;
                void navigator.clipboard.writeText(url).then(() => {
                  setCopied(true);
                  window.setTimeout(() => {
                    setCopied(false);
                  }, 1_500);
                });
              }}
              publicProfileId={profile.publicProfileId}
            />
          )}
        </section>
      </form>
    </div>
  );
}

function ProfileLink({
  copied,
  onCopy,
  publicProfileId,
}: {
  readonly copied: boolean;
  readonly onCopy: () => void;
  readonly publicProfileId: string;
}) {
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-muted/45 p-2 pl-4">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        /members/{publicProfileId}
      </code>
      <Button aria-label="Скопировать ссылку на профиль" className="size-11" onClick={onCopy} size="icon" type="button" variant="ghost">
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Ссылка скопирована" : ""}
      </span>
    </div>
  );
}

function MutationNotice({ state }: { readonly state: ProfileMutationState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "saved") {
    return (
      <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-foreground" role="status">
        <Check aria-hidden="true" className="size-4 text-accent" />
        Профиль сохранён.
      </p>
    );
  }
  if (state.kind === "conflict") {
    return (
      <div className="mt-5 rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm" role="alert">
        <p className="font-semibold">Профиль уже изменился в другой вкладке.</p>
        <button className="mt-2 inline-flex items-center gap-2 font-semibold underline underline-offset-4" onClick={() => {
          window.location.reload();
        }} type="button">
          <RotateCcw aria-hidden="true" className="size-4" />
          Загрузить актуальную версию
        </button>
      </div>
    );
  }
  if (state.kind === "invalid_input") return null;
  return (
    <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm" role="alert">
      {state.kind === "unauthorized"
        ? "Сессия завершилась. Войдите снова, чтобы продолжить."
        : `Не удалось выполнить действие. Повторите попытку. Код: ${state.reference}`}
    </p>
  );
}

function emptyToNull(value: string): string | null {
  return value.trim().length === 0 ? null : value;
}
