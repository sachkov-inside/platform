"use client";

import type { PriceSnapshot } from "@/entities/subscription";
import { hasText } from "@/shared/lib/text";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import {
  canRevokeInvitation,
  invitationNoteMaxLength,
  invitationOfferChoices,
  invitationOfferNames,
  invitationShareText,
  invitationStateFilters,
  invitationStateLabel,
  invitationUsableUntil,
  type Invitation,
  type InvitationMode,
  type InvitationState,
  type InvitationStateFilter,
} from "../model/invitation-operations";
import {
  AdminSection,
  AdminSelect,
  AdminTextArea,
  formText,
  onAdminSubmit,
} from "./admin-form.client";

/** Решение владельца из формы выдачи: ссылку на операцию добавляет панель. */
export interface IssueInvitationRequest {
  readonly offerId: string;
  readonly mode: InvitationMode;
  readonly note: string | null;
}

export interface InvitationsViewProps {
  /** Каталог владельца: из него берутся названия предложений и выбор формы. */
  readonly offers: readonly PriceSnapshot[];
  readonly invitations: readonly Invitation[];
  readonly loading: boolean;
  /** Список не прочитался: показывается вместо пустого списка. */
  readonly error: string | null;
  readonly filter: InvitationStateFilter;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly busy: boolean;
  /** Только что выданное приглашение: его ссылку владелец копирует и отправляет. */
  readonly issued: Invitation | null;
  readonly message: string;
  /** Отказ последней команды словами владельца. */
  readonly failure: string | null;
  readonly onFilterChange: (filter: InvitationStateFilter) => void;
  readonly onLoadMore: () => void;
  readonly onIssue: (request: IssueInvitationRequest) => void;
  readonly onRevoke: (invitation: Invitation) => void;
  readonly onCopy: (text: string) => void;
}

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeZone: "Europe/Moscow",
});

function formatDate(value: string): string {
  return dateFormat.format(new Date(value));
}

const stateTone: Record<InvitationState, string> = {
  issued: "border-border bg-muted text-foreground",
  claimed: "border-accent/35 bg-accent/6 text-foreground",
  redeemed: "border-primary bg-primary text-primary-foreground",
  expired: "border-border bg-background text-muted-foreground",
  revoked: "border-destructive/30 bg-destructive/6 text-destructive",
};

/**
 * Приглашения: личная ссылка на бота, которая открывает человеку оплату выбранного предложения
 * . Одноразовость, срок жизни и погашение держит Platform; страница выдаёт,
 * показывает и отзывает.
 */
export function InvitationsView(props: InvitationsViewProps) {
  const names = invitationOfferNames(props.offers);
  return (
    <div className="grid gap-6">
      <IssueInvitationForm
        busy={props.busy}
        offers={props.offers}
        onIssue={props.onIssue}
      />
      <p aria-live="polite" className="break-words text-sm" role="status">
        {props.message}
      </p>
      {hasText(props.failure) ? (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm"
          role="alert"
        >
          {props.failure}
        </p>
      ) : null}
      {props.issued === null ? null : (
        <IssuedInvitation
          invitation={props.issued}
          offerName={names.get(props.issued.offerId)}
          onCopy={props.onCopy}
        />
      )}
      <AdminSection
        title="Выданные приглашения"
        description="Новые сверху. Отозвать можно, пока приглашение не использовано и не сгорело."
      >
        <StateFilter filter={props.filter} onChange={props.onFilterChange} />
        {props.loading ? <p role="status">Загружаем приглашения…</p> : null}
        {hasText(props.error) ? <p role="alert">{props.error}</p> : null}
        {!props.loading &&
        !hasText(props.error) &&
        props.invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {props.filter === "all"
              ? "Приглашений пока нет. Выдайте первое формой выше."
              : "В этом состоянии приглашений нет."}
          </p>
        ) : null}
        {props.invitations.length === 0 ? null : (
          <ul className="grid gap-3">
            {props.invitations.map((invitation) => (
              <InvitationRow
                busy={props.busy}
                invitation={invitation}
                key={invitation.id}
                offerName={names.get(invitation.offerId)}
                onCopy={props.onCopy}
                onRevoke={props.onRevoke}
              />
            ))}
          </ul>
        )}
        {props.hasMore ? (
          <p>
            <Button
              disabled={props.loadingMore}
              onClick={props.onLoadMore}
              type="button"
              variant="outline"
            >
              {props.loadingMore ? "Загружаем…" : "Показать ещё"}
            </Button>
          </p>
        ) : null}
      </AdminSection>
    </div>
  );
}

function IssueInvitationForm({
  busy,
  offers,
  onIssue,
}: {
  readonly busy: boolean;
  readonly offers: readonly PriceSnapshot[];
  readonly onIssue: (request: IssueInvitationRequest) => void;
}) {
  const choices = invitationOfferChoices(offers);
  return (
    <AdminSection
      title="Новое приглашение"
      description="Человек открывает ссылку в Telegram, бот проверяет приглашение и открывает оплату."
    >
      <form
        className="grid gap-4"
        onSubmit={onAdminSubmit((form) => {
          const note = formText(form.get("invitationNote"));
          onIssue({
            offerId: formText(form.get("invitationOffer")),
            mode: "purchase",
            note: note.length === 0 ? null : note,
          });
        })}
      >
        <AdminSelect
          label="Предложение"
          name="invitationOffer"
          options={choices.map((choice) => ({
            value: choice.id,
            label: choice.name,
          }))}
          placeholder="Выберите предложение"
        />
        <AdminTextArea
          hint={`Для себя: кому и зачем. До ${String(invitationNoteMaxLength)} символов, человек её не видит.`}
          label="Заметка"
          maxLength={invitationNoteMaxLength}
          name="invitationNote"
          rows={2}
        />
        <p>
          <Button disabled={busy || choices.length === 0} type="submit">
            Создать приглашение
          </Button>
        </p>
        {choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            В каталоге нет действующих предложений. Заведите предложение в
            разделе «Оплата и права».
          </p>
        ) : null}
      </form>
    </AdminSection>
  );
}

function IssuedInvitation({
  invitation,
  offerName,
  onCopy,
}: {
  readonly invitation: Invitation;
  readonly offerName: string | undefined;
  readonly onCopy: (text: string) => void;
}) {
  const share = invitationShareText(invitation);
  return (
    <div
      className="grid gap-3 rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm"
      data-issued-invitation
    >
      <p className="font-semibold">
        Приглашение готово: оплата
        {offerName === undefined ? "" : ` «${offerName}»`}. Оно сработает один
        раз до {formatDate(invitation.expiresAt)}.
      </p>
      <p className="break-all font-mono">{share}</p>
      {invitation.link === null ? (
        <p className="text-muted-foreground">
          Имя бота не настроено, поэтому готовой ссылки нет. Отправьте человеку
          ссылку на бота с этим параметром запуска.
        </p>
      ) : null}
      <p>
        <Button
          onClick={() => {
            onCopy(share);
          }}
          type="button"
          variant="outline"
        >
          Скопировать ссылку
        </Button>
      </p>
    </div>
  );
}

function StateFilter({
  filter,
  onChange,
}: {
  readonly filter: InvitationStateFilter;
  readonly onChange: (filter: InvitationStateFilter) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">Состояние приглашения</legend>
      <div className="flex flex-wrap gap-2">
        {invitationStateFilters.map((option) => (
          <Button
            aria-pressed={filter === option.value}
            key={option.value}
            onClick={() => {
              onChange(option.value);
            }}
            size="sm"
            type="button"
            variant={filter === option.value ? "secondary" : "ghost"}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function InvitationRow({
  busy,
  invitation,
  offerName,
  onCopy,
  onRevoke,
}: {
  readonly busy: boolean;
  readonly invitation: Invitation;
  readonly offerName: string | undefined;
  readonly onCopy: (text: string) => void;
  readonly onRevoke: (invitation: Invitation) => void;
}) {
  const usableUntil = invitationUsableUntil(invitation);
  const title = offerName ?? "Предложение не найдено в каталоге";
  return (
    <li
      aria-label={`${title}: ${invitationStateLabel(invitation.state)}`}
      className="grid min-w-0 gap-2 rounded-xl border border-border p-4 text-sm"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words font-semibold">{title}</span>
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs font-medium",
            stateTone[invitation.state],
          )}
        >
          {invitationStateLabel(invitation.state)}
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-muted-foreground sm:grid-cols-2">
        <div className="flex gap-2">
          <dt>Вид:</dt>
          <dd className="text-foreground">Оплата</dd>
        </div>
        <div className="flex gap-2">
          <dt>Выдано:</dt>
          <dd className="text-foreground">{formatDate(invitation.issuedAt)}</dd>
        </div>
        {usableUntil === null ? null : (
          <div className="flex gap-2">
            <dt>Действует до:</dt>
            <dd className="text-foreground">{formatDate(usableUntil)}</dd>
          </div>
        )}
        {hasText(invitation.note) ? (
          <div className="flex min-w-0 gap-2 sm:col-span-2">
            <dt>Заметка:</dt>
            <dd className="min-w-0 break-words text-foreground">
              {invitation.note}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            onCopy(invitationShareText(invitation));
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {invitation.link === null
            ? "Скопировать параметр"
            : "Скопировать ссылку"}
        </Button>
        {canRevokeInvitation(invitation) ? (
          <Button
            disabled={busy}
            onClick={() => {
              onRevoke(invitation);
            }}
            size="sm"
            type="button"
            variant="destructive"
          >
            Отозвать
          </Button>
        ) : null}
      </div>
    </li>
  );
}
