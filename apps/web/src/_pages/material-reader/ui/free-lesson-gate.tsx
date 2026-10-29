import type { Route } from "next";
import { ArrowRight, Send } from "lucide-react";

import { Button } from "@/shared/ui/button";

import { FreeLessonTelegramLink } from "./free-lesson-telegram-link.client";

/**
 * Бесплатный урок курса открывается после входа через Telegram (#1825). Гость входит и
 * возвращается в тот же урок; вошедший по почте подключает Telegram здесь же. Покупка не нужна.
 */
export function FreeLessonGate({
  signedIn,
  returnTo,
}: {
  readonly signedIn: boolean;
  readonly returnTo: Route;
}) {
  return (
    <>
      <span className="grid size-12 place-items-center rounded-full bg-white text-accent shadow-lg">
        <Send aria-hidden="true" className="size-5" />
      </span>
      <h2
        className="mt-4 text-balance text-2xl font-semibold tracking-[-0.04em]"
        id="access-heading"
      >
        Бесплатный урок
      </h2>
      <p className="mt-2 max-w-sm text-pretty text-sm leading-6 text-muted-foreground">
        {signedIn
          ? "Подключите Telegram к аккаунту, и урок откроется целиком. Покупать курс не нужно."
          : "Войдите через Telegram, и урок откроется целиком. Покупать курс не нужно."}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {signedIn ? (
          <FreeLessonTelegramLink />
        ) : (
          <form action="/auth/sign-in" method="post">
            <input name="returnTo" type="hidden" value={returnTo} />
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal rounded-xl bg-accent px-4 text-white hover:bg-accent-hover"
              size="lg"
              type="submit"
            >
              Войти через Telegram и читать бесплатно
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          </form>
        )}
      </div>
    </>
  );
}
