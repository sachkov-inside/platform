"use client";
import type { ReactNode } from "react";
import { FileText, LogOut } from "lucide-react";
import { AccountDisclosure } from "./account-disclosure.client";
import {
  AccountTelegramPanel,
  type AccountTelegramMembership,
} from "@/features/account-access";
import {
  AcceptedDocumentsPanel,
  type AcceptedDocumentsPanelProps,
} from "@/features/accepted-documents";
import { Button } from "@/shared/ui/button";

export interface AccountAccessViewProps {
  readonly acceptedDocuments: AcceptedDocumentsPanelProps;
  readonly link: AccountTelegramMembership["link"] | null;
  readonly telegramContact?: AccountTelegramMembership["contact"];
  readonly displayName?: string | undefined;
  readonly billingSlot?: ReactNode;
  readonly profileSlot?: ReactNode;
  readonly emailSlot?: ReactNode;
  readonly continuationSlot?: ReactNode;
  readonly loading?: boolean;
  readonly sessionExpired?: boolean;
  readonly unavailable?: boolean;
  readonly onTelegramRefresh: () => Promise<void>;
}

/**
 * Temporary semantic UI for #1586.
 * Replace through #1587 after Storybook acceptance.
 */
export function AccountAccessView({
  acceptedDocuments,
  link,
  displayName,
  telegramContact,
  billingSlot,
  profileSlot,
  emailSlot,
  continuationSlot,
  loading = false,
  sessionExpired = false,
  unavailable = false,
  onTelegramRefresh,
}: AccountAccessViewProps) {
  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">
            Личный кабинет
          </h1>
          {displayName === undefined ? null : (
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {displayName}
            </p>
          )}
        </div>
        {sessionExpired ? null : (
          <form action="/auth/sign-out" method="post">
            <Button className="min-h-11 px-3" type="submit" variant="ghost">
              <LogOut aria-hidden="true" className="size-4" />
              Выйти из аккаунта
            </Button>
          </form>
        )}
      </header>
      {sessionExpired ? (
        <div className="py-4">
          <p className="text-sm leading-6">
            Войдите, чтобы открыть личный кабинет.
          </p>
          <form action="/auth/sign-in" className="mt-4" method="post">
            <input name="returnTo" type="hidden" value="/account" />
            <Button className="min-h-11 px-4" type="submit">
              Войти
            </Button>
          </form>
        </div>
      ) : (
        <div className="space-y-6">
          {profileSlot}
          <section
            aria-labelledby="account-connections"
            className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6"
          >
            <div className="mb-6">
              <h2 className="text-lg font-semibold" id="account-connections">
                Контакты и вход
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Почта для входа и подключённый Telegram.
              </p>
            </div>
            <div className="space-y-8">
              {emailSlot}
              {loading ? (
                <p className="py-4 text-sm text-muted-foreground" role="status">
                  Загружаем состояние аккаунта…
                </p>
              ) : unavailable || link === null ? (
                <div className="py-4 text-sm" role="alert">
                  <p>Состояние аккаунта сейчас недоступно.</p>
                  <button
                    className="mt-2 min-h-11 underline underline-offset-4"
                    onClick={() => {
                      void onTelegramRefresh();
                    }}
                    type="button"
                  >
                    Попробовать снова
                  </button>
                </div>
              ) : (
                <AccountTelegramPanel
                  contact={telegramContact}
                  link={link}
                  onRefresh={onTelegramRefresh}
                />
              )}
            </div>
          </section>
          {continuationSlot}
          <div className="space-y-4">
            {billingSlot}
            <AccountDisclosure
              description="Условия использования и обработка данных"
              icon={FileText}
              id="documents"
              title="Документы"
            >
              <AcceptedDocumentsPanel {...acceptedDocuments} />
            </AccountDisclosure>
          </div>
        </div>
      )}
    </div>
  );
}
