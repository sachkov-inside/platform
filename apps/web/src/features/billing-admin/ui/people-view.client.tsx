"use client";
import { useId, useState } from "react";
import type { SubmitEvent } from "react";

import { hasText } from "@/shared/lib/text";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import {
  accessSourceLabel,
  accessSources,
  groundActions,
  groundStateLabel,
  groundTitle,
  holderStateLabel,
  holderStates,
  lastMoscowDay,
  type AccessHolder,
  type GroundState,
  type PeopleFilters,
  type PersonGround,
} from "../model/access-operations";
import {
  giftMonthsMax,
  invitationNoteMaxLength,
  invitationShareText,
  type Invitation,
} from "../model/invitation-operations";
import {
  AdminField,
  AdminSection,
  AdminSelect,
  formText,
  reasonMaxLength,
} from "./admin-form.client";

export interface OfferChoice {
  readonly id: string;
  readonly name: string;
}
/** Решение владельца об основании: срок задаётся последним днём доступа по Москве. */
export interface GroundChangeRequest {
  readonly ground: PersonGround;
  readonly action: "extend" | "revoke" | "restore";
  readonly until: string | null;
  readonly reason: string;
}
export interface AssignRequest {
  readonly accountId: string;
  readonly offerId: string;
  readonly until: string | null;
  readonly reason: string;
}
export interface GiftRequest {
  readonly accountId: string;
  readonly offerId: string;
  readonly giftMonths: number | null;
  readonly note: string | null;
}

export interface PeopleViewProps {
  /** Offer для фильтра, в том числе архивные: у людей мог остаться доступ по ним. */
  readonly offers: readonly OfferChoice[];
  /** Offer, открытые для назначения: их назначают и дарят из карточки. */
  readonly assignable: readonly OfferChoice[];
  readonly people: readonly AccessHolder[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly filters: PeopleFilters;
  readonly busy: boolean;
  readonly message: string;
  readonly failure: string | null;
  /** Только что выданное подарочное приглашение и Account, для которого его выдали. */
  readonly gift: {
    readonly accountId: string;
    readonly invitation: Invitation;
  } | null;
  readonly onFiltersChange: (filters: PeopleFilters) => void;
  readonly onLoadMore: () => void;
  readonly onChangeGround: (request: GroundChangeRequest) => void;
  readonly onAssign: (request: AssignRequest) => void;
  readonly onGift: (request: GiftRequest) => void;
  readonly onCopy: (text: string) => void;
}

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeZone: "Europe/Moscow",
});
function formatDate(value: string): string {
  return dateFormat.format(new Date(value));
}
/** Последний день доступа: конец срока — начало следующих суток по Москве. */
function formatUntil(endsAt: string): string {
  return formatDate(`${lastMoscowDay(endsAt)}T12:00:00+03:00`);
}
function groundTerm(ground: PersonGround): string {
  if (ground.revokedAt !== null)
    return `отозван ${formatDate(ground.revokedAt)}`;
  return ground.endsAt === null
    ? "бессрочно"
    : `до ${formatUntil(ground.endsAt)} включительно`;
}

const stateTone: Record<GroundState, string> = {
  scheduled: "border-accent/35 bg-accent/6 text-foreground",
  active: "border-primary bg-primary text-primary-foreground",
  ended: "border-border bg-background text-muted-foreground",
  revoked: "border-destructive/30 bg-destructive/6 text-destructive",
};

/**
 * Люди и доступ: у кого какое основание, откуда оно и до какого числа. Карточка человека
 * продлевает, отзывает и назначает доступ существующими командами и выдаёт подарочное приглашение.
 */
export function PeopleView(props: PeopleViewProps) {
  return (
    <div className="grid gap-6">
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
      <AdminSection
        title="Люди и доступ"
        description="Действующие основания и закончившиеся за последние 30 дней. Откройте человека, чтобы изменить его доступ."
      >
        <Filters
          filters={props.filters}
          offers={props.offers}
          onChange={props.onFiltersChange}
        />
        {props.loading ? <p role="status">Загружаем людей…</p> : null}
        {hasText(props.error) ? <p role="alert">{props.error}</p> : null}
        {!props.loading &&
        !hasText(props.error) &&
        props.people.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Под эти фильтры никто не подходит.
          </p>
        ) : null}
        {props.people.length === 0 ? null : (
          <ul aria-label="Люди" className="grid gap-3">
            {props.people.map((person) => (
              <PersonCard
                assignable={props.assignable}
                busy={props.busy}
                gift={
                  props.gift?.accountId === person.accountId
                    ? props.gift.invitation
                    : null
                }
                key={person.accountId}
                onAssign={props.onAssign}
                onChangeGround={props.onChangeGround}
                onCopy={props.onCopy}
                onGift={props.onGift}
                person={person}
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

function Filters({
  filters,
  offers,
  onChange,
}: {
  readonly filters: PeopleFilters;
  readonly offers: readonly OfferChoice[];
  readonly onChange: (filters: PeopleFilters) => void;
}) {
  const offerId = useId();
  const sourceId = useId();
  const stateId = useId();
  const select =
    "min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <fieldset className="grid gap-3 sm:grid-cols-3">
      <legend className="sr-only">Фильтры</legend>
      <p className="grid min-w-0 gap-1">
        <label className="text-sm font-semibold" htmlFor={offerId}>
          Offer или курс
        </label>
        <select
          className={select}
          id={offerId}
          onChange={(event) => {
            const value = event.currentTarget.value;
            onChange({ ...filters, offerId: value === "" ? null : value });
          }}
          value={filters.offerId ?? ""}
        >
          <option value="">Все</option>
          {offers.map((offer) => (
            <option key={offer.id} value={offer.id}>
              {offer.name}
            </option>
          ))}
        </select>
      </p>
      <p className="grid min-w-0 gap-1">
        <label className="text-sm font-semibold" htmlFor={sourceId}>
          Источник
        </label>
        <select
          className={select}
          id={sourceId}
          onChange={(event) => {
            const value = accessSources.find(
              (source) => source === event.currentTarget.value,
            );
            onChange({ ...filters, source: value ?? null });
          }}
          value={filters.source ?? ""}
        >
          <option value="">Все</option>
          {accessSources.map((source) => (
            <option key={source} value={source}>
              {accessSourceLabel(source)}
            </option>
          ))}
        </select>
      </p>
      <p className="grid min-w-0 gap-1">
        <label className="text-sm font-semibold" htmlFor={stateId}>
          Состояние
        </label>
        <select
          className={select}
          id={stateId}
          onChange={(event) => {
            const value = holderStates.find(
              (state) => state === event.currentTarget.value,
            );
            onChange({ ...filters, state: value ?? null });
          }}
          value={filters.state ?? ""}
        >
          <option value="">Все</option>
          {holderStates.map((state) => (
            <option key={state} value={state}>
              {holderStateLabel(state)}
            </option>
          ))}
        </select>
      </p>
    </fieldset>
  );
}

function PersonCard({
  person,
  assignable,
  busy,
  gift,
  onChangeGround,
  onAssign,
  onGift,
  onCopy,
}: {
  readonly person: AccessHolder;
  readonly assignable: readonly OfferChoice[];
  readonly busy: boolean;
  readonly gift: Invitation | null;
  readonly onChangeGround: PeopleViewProps["onChangeGround"];
  readonly onAssign: PeopleViewProps["onAssign"];
  readonly onGift: PeopleViewProps["onGift"];
  readonly onCopy: PeopleViewProps["onCopy"];
}) {
  const telegram = person.telegramIdentityRef ?? "Telegram не привязан";
  return (
    <li
      aria-label={`Account ${person.accountId}`}
      className="min-w-0 rounded-xl border border-border text-sm"
    >
      <details className="group">
        <summary className="grid cursor-pointer gap-2 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-all font-mono text-xs">
              {person.accountId}
            </span>
            <span className="text-xs text-muted-foreground">{telegram}</span>
          </span>
          <span className="grid gap-1">
            {person.grounds.map((ground) => (
              <span
                className="flex min-w-0 flex-wrap items-center gap-2"
                key={ground.id}
              >
                <span className="min-w-0 break-words font-semibold">
                  {groundTitle(ground)}
                </span>
                <span className="text-muted-foreground">
                  {accessSourceLabel(ground.source)} · {groundTerm(ground)}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs font-medium",
                    stateTone[ground.state],
                  )}
                >
                  {groundStateLabel(ground.state)}
                </span>
              </span>
            ))}
          </span>
        </summary>
        <div className="grid gap-5 border-t border-border p-4">
          {person.grounds.map((ground) => (
            <GroundForm
              busy={busy}
              ground={ground}
              key={ground.id}
              onChange={onChangeGround}
            />
          ))}
          <AssignForm
            accountId={person.accountId}
            assignable={assignable}
            busy={busy}
            onAssign={onAssign}
          />
          <GiftForm
            accountId={person.accountId}
            assignable={assignable}
            busy={busy}
            gift={gift}
            onCopy={onCopy}
            onGift={onGift}
          />
        </div>
      </details>
    </li>
  );
}

/** Кнопка отправки называет действие: форма одна на основание, действий у неё до трёх. */
function submittedAction(
  event: SubmitEvent<HTMLFormElement>,
): "extend" | "revoke" | "restore" | null {
  const submitter = event.nativeEvent.submitter;
  const value = submitter instanceof HTMLButtonElement ? submitter.value : "";
  return value === "extend" || value === "revoke" || value === "restore"
    ? value
    : null;
}

function GroundForm({
  busy,
  ground,
  onChange,
}: {
  readonly busy: boolean;
  readonly ground: PersonGround;
  readonly onChange: PeopleViewProps["onChangeGround"];
}) {
  const actions = groundActions(ground);
  const title = `${groundTitle(ground)} · ${accessSourceLabel(ground.source)}`;
  if (!actions.extend && !actions.revoke && !actions.restore)
    return (
      <div className="grid gap-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-muted-foreground">
          {ground.source === "one_time_purchase"
            ? "Разовую покупку меняет только возврат в разделе «Оплата и права»."
            : "Право отозвано: выдайте доступ заново формой ниже."}
        </p>
      </div>
    );
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const action = submittedAction(event);
        if (action === null) return;
        const data = new FormData(event.currentTarget);
        const until = formText(data.get("until"));
        onChange({
          ground,
          action,
          until: action === "extend" && until !== "" ? until : null,
          reason: formText(data.get("reason")),
        });
      }}
    >
      <fieldset className="grid min-w-0 gap-3">
        <legend className="font-semibold">{title}</legend>
        {actions.extend ? (
          <AdminField
            defaultValue={
              ground.endsAt === null ? "" : lastMoscowDay(ground.endsAt)
            }
            hint="Последний день доступа по Москве. Пусто — бессрочно."
            label="Доступ до"
            name="until"
            type="date"
          />
        ) : null}
        <AdminField
          label="Причина"
          maxLength={reasonMaxLength}
          name="reason"
          required
        />
        <div className="flex flex-wrap gap-2">
          {actions.extend ? (
            <Button
              disabled={busy}
              size="sm"
              type="submit"
              value="extend"
              variant="outline"
            >
              Изменить срок
            </Button>
          ) : null}
          {actions.revoke ? (
            <Button
              disabled={busy}
              size="sm"
              type="submit"
              value="revoke"
              variant="destructive"
            >
              Отозвать
            </Button>
          ) : null}
          {actions.restore ? (
            <Button disabled={busy} size="sm" type="submit" value="restore">
              Восстановить
            </Button>
          ) : null}
        </div>
      </fieldset>
    </form>
  );
}

function AssignForm({
  accountId,
  assignable,
  busy,
  onAssign,
}: {
  readonly accountId: string;
  readonly assignable: readonly OfferChoice[];
  readonly busy: boolean;
  readonly onAssign: PeopleViewProps["onAssign"];
}) {
  return (
    <form
      className="grid gap-3 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const until = formText(data.get("assignUntil"));
        onAssign({
          accountId,
          offerId: formText(data.get("assignOffer")),
          until: until === "" ? null : until,
          reason: formText(data.get("assignReason")),
        });
      }}
    >
      <fieldset className="grid min-w-0 gap-3">
        <legend className="font-semibold">Назначить тариф</legend>
        <AdminSelect
          label="Тариф для назначения"
          name="assignOffer"
          options={assignable.map((offer) => ({
            value: offer.id,
            label: offer.name,
          }))}
          placeholder="Выберите тариф"
        />
        <AdminField
          hint="Последний день доступа по Москве. Пусто — бессрочно."
          label="Назначить до"
          name="assignUntil"
          type="date"
        />
        <AdminField
          label="Причина назначения"
          maxLength={reasonMaxLength}
          name="assignReason"
          required
        />
        <p>
          <Button
            disabled={busy || assignable.length === 0}
            size="sm"
            type="submit"
          >
            Назначить без оплаты
          </Button>
        </p>
      </fieldset>
    </form>
  );
}

function GiftForm({
  accountId,
  assignable,
  busy,
  gift,
  onGift,
  onCopy,
}: {
  readonly accountId: string;
  readonly assignable: readonly OfferChoice[];
  readonly busy: boolean;
  readonly gift: Invitation | null;
  readonly onGift: PeopleViewProps["onGift"];
  readonly onCopy: PeopleViewProps["onCopy"];
}) {
  const [unlimited, setUnlimited] = useState(false);
  return (
    <form
      className="grid gap-3 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const note = formText(data.get("giftNote"));
        onGift({
          accountId,
          offerId: formText(data.get("giftOffer")),
          giftMonths: unlimited
            ? null
            : Number(formText(data.get("giftMonths"))),
          note: note === "" ? null : note,
        });
      }}
    >
      <fieldset className="grid min-w-0 gap-3">
        <legend className="font-semibold">Подарочное приглашение</legend>
        <p className="text-muted-foreground">
          Ссылка в бота дарит тариф тому, кто откроет её первым. Отправьте её
          этому человеку.
        </p>
        <AdminSelect
          label="Тариф в подарок"
          name="giftOffer"
          options={assignable.map((offer) => ({
            value: offer.id,
            label: offer.name,
          }))}
          placeholder="Выберите тариф"
        />
        <label className="flex items-center gap-2">
          <input
            checked={unlimited}
            className="size-4 rounded border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onChange={(event) => {
              setUnlimited(event.currentTarget.checked);
            }}
            type="checkbox"
          />
          Бессрочно
        </label>
        {unlimited ? null : (
          <AdminField
            hint={`Целое число от 1 до ${String(giftMonthsMax)}.`}
            inputMode="numeric"
            label="Месяцев подарка"
            max={giftMonthsMax}
            min={1}
            name="giftMonths"
            required
            step={1}
            type="number"
          />
        )}
        <AdminField
          defaultValue={`Account ${accountId}`}
          label="Заметка к приглашению"
          maxLength={invitationNoteMaxLength}
          name="giftNote"
        />
        <p>
          <Button
            disabled={busy || assignable.length === 0}
            size="sm"
            type="submit"
            variant="outline"
          >
            Выдать подарочное приглашение
          </Button>
        </p>
        {gift === null ? null : (
          <div
            className="grid gap-2 rounded-xl border border-accent/35 bg-accent/6 p-3"
            data-gift-invitation
          >
            <p className="font-semibold">
              Приглашение готово. Оно сработает один раз до{" "}
              {formatDate(gift.expiresAt)}.
            </p>
            <p className="break-all font-mono">{invitationShareText(gift)}</p>
            <p>
              <Button
                onClick={() => {
                  onCopy(invitationShareText(gift));
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Скопировать ссылку
              </Button>
            </p>
          </div>
        )}
      </fieldset>
    </form>
  );
}
