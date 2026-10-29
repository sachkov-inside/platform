import type { Route } from "next";
import { ArrowRight, Send } from "lucide-react";

import type { MaterialReaderMetadata } from "@/_pages/material-reader/model/material-reader-view";
import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import type { ProductReaderContext } from "@/_pages/material-reader/model/product-reader-context";
import { Button } from "@/shared/ui/button";

import { FreeLessonTelegramLink } from "./free-lesson-telegram-link.client";
import {
  MaterialReaderAccess,
  readerAccessActionClass,
} from "./material-reader-states";

/**
 * Бесплатный урок курса открывается после входа через Telegram (#1825). Гость входит и
 * возвращается в тот же урок; вошедший по почте подключает Telegram здесь же. Покупка не нужна.
 */
export function FreeLessonAccess({
  signedIn,
  returnTo,
  material,
  returnTarget,
  productContext,
}: {
  readonly signedIn: boolean;
  readonly returnTo: Route;
  readonly material: MaterialReaderMetadata;
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly productContext?: ProductReaderContext | null;
}) {
  return (
    <MaterialReaderAccess
      gate={{
        icon: <Send aria-hidden="true" className="size-5" />,
        title: "Бесплатный урок",
        explanation: signedIn
          ? "Подключите Telegram к аккаунту, и урок откроется целиком. Покупать курс не нужно."
          : "Войдите через Telegram, и урок откроется целиком. Покупать курс не нужно.",
        action: signedIn ? (
          <FreeLessonTelegramLink className={readerAccessActionClass} />
        ) : (
          <form action="/auth/sign-in" method="post">
            <input name="returnTo" type="hidden" value={returnTo} />
            <Button className={readerAccessActionClass} size="lg" type="submit">
              Войти через Telegram и читать бесплатно
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          </form>
        ),
      }}
      invitation={null}
      material={material}
      {...(returnTarget === undefined ? {} : { returnTarget })}
      {...(productContext === undefined ? {} : { productContext })}
    />
  );
}
