"use client";
import { Check, Copy, RotateCcw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
  bioLengthIsValid,
  displayNameLengthIsValid,
  memberProfileTextLength,
  type PrivateMemberProfile,
} from "@/entities/member-profile";
import { Button } from "@/shared/ui/button";
import { AccountSectionHeader } from "@/widgets/account-cabinet";

import { createMemberProfile } from "../api/create-member-profile.browser";
import { updateMemberProfile } from "../api/update-member-profile.browser";
import type { CreateMemberProfileResult } from "../model/create-member-profile";
import type { UpdateMemberProfileResult } from "../model/update-member-profile";
import { ProfileAvatarEditor } from "./profile-avatar-editor.client";

interface AccountPageClientProps {
  readonly initialProfile: PrivateMemberProfile | null;
  readonly onProfileChange?: (profile: PrivateMemberProfile) => void;
}

export function AccountPageClient({
  initialProfile,
  onProfileChange,
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
  const createMutation = useMutation({
    mutationFn: createMemberProfile,
    onSuccess: (result) => {
      if (result.kind === "saved") {
        setDisplayName(result.profile.displayName);
        setBio(result.profile.bio ?? "");
        setNameTouched(false);
        setBioTouched(false);
        setProfile(result.profile);
        onProfileChange?.(result.profile);
      }
    },
  });
  const updateMutation = useMutation({
    mutationFn: updateMemberProfile,
    onSuccess: (result) => {
      if (result.kind === "saved") {
        setDisplayName(result.profile.displayName);
        setBio(result.profile.bio ?? "");
        setNameTouched(false);
        setBioTouched(false);
        setProfile(result.profile);
        onProfileChange?.(result.profile);
      }
    },
  });
  const saveResult = updateMutation.data ?? createMutation.data ?? null;
  const savePending = createMutation.isPending || updateMutation.isPending;
  const nameLength = memberProfileTextLength(displayName.trim());
  const bioLength = memberProfileTextLength(bio);
  const serverNameError =
    saveResult?.kind === "invalid_input"
      ? saveResult.fieldErrors.displayName
      : undefined;
  const serverBioError =
    saveResult?.kind === "invalid_input" ? saveResult.fieldErrors.bio : undefined;
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
    <div>
      <AccountSectionHeader section="profile" />

      {profile?.status === "disabled" ? (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm">
          <p className="font-semibold">Профиль скрыт модерацией</p>
          <p className="mt-1 text-muted-foreground">
            Другие участники получают безопасную страницу 404. Поля можно исправить;
            восстановление выполняет владелец платформы.
          </p>
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (profile === null) {
            createMutation.mutate({ bio, displayName });
            return;
          }
          updateMutation.mutate({
            bio,
            displayName,
            expectedVersion: profile.version,
          });
        }}
      >
        <section
          aria-labelledby="profile-heading"
          className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-7"
        >
          <h2 className="sr-only" id="profile-heading">
            Ваш профиль
          </h2>

          {profile === null ? (
            <div className="flex items-center gap-4 border-b border-border pb-7">
              <ProfileAvatarPlaceholder displayName={displayName} />
              <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">
                Аватар можно будет загрузить сразу после создания профиля.
              </p>
            </div>
          ) : (
            <ProfileAvatarEditor
              onProfileChange={(updated) => {
                setProfile(updated);
                onProfileChange?.(updated);
              }}
              profile={profile}
            />
          )}

          <div className="mt-7 grid gap-7">
            <div>
              <label className="text-sm font-semibold" htmlFor="profile-display-name">
                Имя
              </label>
              <input
                aria-describedby={`${nameHelpId}${nameInvalid ? ` ${nameErrorId}` : ""}`}
                aria-invalid={nameInvalid || undefined}
                className="profile-field mt-2 min-h-14 w-full rounded-xl border border-input bg-background px-4 text-2xl font-bold tracking-[-0.025em] shadow-sm transition-colors placeholder:text-xl placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/65 focus:border-ring"
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

          {profile === null ? (
            <p className="mt-7 border-t border-border pt-7 text-sm leading-6 text-muted-foreground">
              После создания профиль получит постоянную ссылку для участников.
            </p>
          ) : (
            <div className="mt-7 border-t border-border pt-7">
              <p className="text-sm font-semibold">Ссылка для участников</p>
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
            </div>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-4">
            <Button
              className="min-h-11 px-4"
              disabled={savePending || nameInvalid || bioInvalid || !fieldsAreValid || !fieldsAreDirty}
              type="submit"
            >
              {savePending ? "Сохраняем…" : profile === null ? "Создать профиль" : "Сохранить"}
            </Button>
            <MutationNotice result={saveResult} />
          </div>
        </section>
      </form>
    </div>
  );
}

/** До создания профиля аватара ещё нет: место под него занимает та же круглая заглушка. */
function ProfileAvatarPlaceholder({ displayName }: { readonly displayName: string }) {
  const initials = displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className="grid size-16 shrink-0 place-items-center rounded-full bg-secondary text-lg font-bold text-muted-foreground"
    >
      {initials === "" ? "\u00A0" : initials}
    </span>
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

function MutationNotice({
  result,
}: {
  readonly result: CreateMemberProfileResult | UpdateMemberProfileResult | null;
}) {
  if (result === null) return null;
  if (result.kind === "saved") {
    return (
      <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-foreground" role="status">
        <Check aria-hidden="true" className="size-4 text-accent" />
        Профиль сохранён.
      </p>
    );
  }
  if (result.kind === "conflict") {
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
  if (result.kind === "invalid_input") return null;
  return (
    <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm" role="alert">
      {result.kind === "unauthorized"
        ? "Сессия завершилась. Войдите снова, чтобы продолжить."
        : `Не удалось выполнить действие. Повторите попытку. Код: ${result.reference}`}
    </p>
  );
}

function emptyToNull(value: string): string | null {
  return value.trim().length === 0 ? null : value;
}
