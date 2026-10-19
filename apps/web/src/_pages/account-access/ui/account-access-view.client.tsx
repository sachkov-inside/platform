"use client";
import type { ReactNode } from "react";
import { FileText } from "lucide-react";
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
  readonly email?: string | undefined;
  readonly billingSlot?: ReactNode;
  readonly continuationSlot?: ReactNode;
  readonly loading?: boolean;
  readonly sessionExpired?: boolean;
  readonly unavailable?: boolean;
  readonly onTelegramRefresh: () => Promise<void>;
}

/** One cabinet for essential account actions; private profile data stays stored. */
export function AccountAccessView({
  acceptedDocuments,
  link,
  email,
  billingSlot,
  continuationSlot,
  loading = false,
  sessionExpired = false,
  unavailable = false,
  onTelegramRefresh,
}: AccountAccessViewProps) {
  return (
    <div>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            Личный кабинет
          </h1>
          {email === undefined ? null : (
            <p className="mt-3 break-all text-sm text-muted-foreground">
              {email}
            </p>
          )}
        </div>
        {sessionExpired ? null : (
          <form action="/auth/sign-out" method="post">
            <Button className="min-h-11 px-3" type="submit" variant="ghost">
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
        <>
          {continuationSlot}
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
            <AccountTelegramPanel link={link} onRefresh={onTelegramRefresh} />
          )}
          <div className="mt-4">{billingSlot}</div>
          <AccountDisclosure
            description="Условия использования и обработка данных"
            icon={FileText}
            id="documents"
            title="Документы"
          >
            <AcceptedDocumentsPanel {...acceptedDocuments} />
          </AccountDisclosure>
        </>
      )}
    </div>
  );
}
