"use client";

import { Plus } from "lucide-react";

import { CopyAccountId, personLabel } from "@/entities/authoring-person";
import {
  useProductAccessActions,
  type AccessCardProduct,
} from "@/features/product-access-actions";
import { formatMoscowDate } from "@/shared/lib/moscow-format";
import { hasText } from "@/shared/lib/text";
import { authoringPeopleHref } from "@/shared/routing/authoring";
import { AdminErrorState, AdminNotFound } from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import type { PersonCard, PersonCardState } from "../model/person-card";
import {
  personCardSections,
  telegramHref,
} from "../model/person-card-presentation";
import { AuthoringPersonFrame } from "./authoring-person-frame";
import { PersonCardAnchors } from "./person-card-anchors";
import {
  PersonLearningBlock,
  PersonPaymentsBlock,
  PersonTelegramBlock,
  PersonWaitlistsBlock,
} from "./person-card-blocks.client";
import { PersonCardSection } from "./person-card-section";
import { PersonProductsBlock } from "./person-products-block.client";

const headingId = "authoring-person-heading";

export interface AuthoringPersonViewProps {
  readonly state: PersonCardState;
  readonly isRefreshing?: boolean;
  readonly onRetry: () => void;
  /** «Обновить данные» после конфликта ревизии: перечитывает карточку. */
  readonly onRefresh: () => Promise<unknown>;
  /** Сервер принял запись доступа: страница перечитывает карточку и список людей. */
  readonly onWritten: () => void;
}

/**
 * Карточка человека (#1721): шапка с главной кнопкой «Выдать продукт» и одна страница с якорями
 * (решение владельца 10). Каждый блок показывает свой сбой сам, остальные остаются на месте.
 */
export function AuthoringPersonView({
  isRefreshing = false,
  onRefresh,
  onRetry,
  onWritten,
  state,
}: AuthoringPersonViewProps) {
  if (state.kind !== "ready")
    return <AuthoringPersonFailure onRetry={onRetry} state={state} />;
  return (
    <PersonCardContent
      card={state.card}
      isRefreshing={isRefreshing}
      onRefresh={onRefresh}
      onRetry={onRetry}
      onWritten={onWritten}
    />
  );
}

function PersonCardContent({
  card,
  isRefreshing,
  onRefresh,
  onRetry,
  onWritten,
}: {
  readonly card: PersonCard;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => Promise<unknown>;
  readonly onRetry: () => void;
  readonly onWritten: () => void;
}) {
  const label = personLabel(card.person);
  const title = label.title ?? label.missing;
  const products: readonly AccessCardProduct[] | null =
    card.products.state === "ready"
      ? card.products.items.map((product) => ({
          access: product.access,
          name: product.name,
          productId: product.productId,
          revision: product.revision,
        }))
      : null;
  const actions = useProductAccessActions({
    accountId: card.person.accountId,
    onRefresh,
    onWritten,
    personTitle: title,
    products,
  });
  const [
    productsSection,
    paymentsSection,
    learningSection,
    telegramSection,
    waitlistsSection,
  ] = personCardSections;

  return (
    <AuthoringPersonFrame busy={isRefreshing} labelledBy={headingId}>
      <div className="grid gap-6" data-person-card-head>
        <header className="person-card-header">
          <div className="grid min-w-0 flex-[1_1_18rem] gap-1">
            <h1
              className={label.title === null ? "text-muted-foreground" : ""}
              id={headingId}
            >
              {title}
            </h1>
            <PersonFacts card={card} />
            <CopyAccountId accountId={card.person.accountId} />
          </div>
          <Button
            className="min-h-11 shrink-0 px-4"
            onClick={actions.openGrant}
            type="button"
          >
            <Plus aria-hidden="true" />
            Выдать продукт
          </Button>
        </header>
        <PersonCardAnchors />
      </div>
      <PersonCardSection id={productsSection.id} title={productsSection.label}>
        {actions.notice}
        <PersonProductsBlock
          actions={actions}
          onRetry={onRetry}
          products={card.products}
        />
      </PersonCardSection>
      <PersonCardSection id={paymentsSection.id} title={paymentsSection.label}>
        <PersonPaymentsBlock
          accountId={card.person.accountId}
          onRetry={onRetry}
          payments={card.payments}
        />
      </PersonCardSection>
      <PersonCardSection id={learningSection.id} title={learningSection.label}>
        <PersonLearningBlock card={card} onRetry={onRetry} />
      </PersonCardSection>
      <PersonCardSection id={telegramSection.id} title={telegramSection.label}>
        <PersonTelegramBlock onRetry={onRetry} telegram={card.telegram} />
      </PersonCardSection>
      <PersonCardSection
        id={waitlistsSection.id}
        title={waitlistsSection.label}
      >
        <PersonWaitlistsBlock onRetry={onRetry} waitlists={card.waitlists} />
      </PersonCardSection>
      {actions.overlay}
    </AuthoringPersonFrame>
  );
}

/** @username ведёт в Telegram, затем email и дата регистрации. Пустые факты не показываются. */
function PersonFacts({ card }: { readonly card: PersonCard }) {
  const { person } = card;
  const href = telegramHref(person.telegramUrl);
  return (
    <p className="person-card-facts">
      {hasText(person.username) ? (
        href === null ? (
          <span>@{person.username}</span>
        ) : (
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            @{person.username}
            <span className="sr-only"> (открыть в Telegram)</span>
          </a>
        )
      ) : null}
      {hasText(person.email) ? <span>{person.email}</span> : null}
      <span>
        Зарегистрирован{" "}
        <time dateTime={person.registeredAt}>
          {formatMoscowDate(person.registeredAt)}
        </time>
      </span>
      {person.contactsState === "partial" ? (
        <span>Часть контактов временно недоступна</span>
      ) : null}
    </p>
  );
}

function AuthoringPersonFailure({
  onRetry,
  state,
}: {
  readonly onRetry: () => void;
  readonly state: Exclude<PersonCardState, { readonly kind: "ready" }>;
}) {
  if (state.kind === "not_found")
    return (
      <AuthoringPersonFrame label="Человек не найден">
        <AdminNotFound
          backHref={authoringPeopleHref}
          backLabel="К списку людей"
          description="Такого человека нет: аккаунт удалён, ссылка неполная или это незарегистрированный посетитель."
          title="Человек не найден"
        />
      </AuthoringPersonFrame>
    );
  const view =
    state.kind === "signed_out"
      ? {
          description:
            "Войдите под аккаунтом владельца, чтобы открыть карточку.",
          title: "Нужен вход",
        }
      : state.kind === "forbidden"
        ? {
            description:
              "Карточки людей открыты аккаунту с правом управлять доступом и оплатами.",
            title: "Нет доступа к людям",
          }
        : {
            description:
              "Карточка временно недоступна. Доступ человека не изменился, повторите чтение.",
            title: "Не удалось открыть карточку",
          };
  return (
    <AuthoringPersonFrame label={view.title}>
      <AdminErrorState
        description={view.description}
        {...(state.kind === "unavailable"
          ? { reference: state.reference }
          : {})}
        {...(state.kind === "signed_out"
          ? {
              retry: (
                <form action="/auth/sign-in" method="post">
                  <Button className="min-h-11 px-4" type="submit">
                    Войти через Telegram
                  </Button>
                </form>
              ),
            }
          : { onRetry })}
        title={view.title}
      />
    </AuthoringPersonFrame>
  );
}
