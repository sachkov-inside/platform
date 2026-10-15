import { redirectUntilTermsAccepted } from "@/features/terms-acceptance.server";
import { requestTelegramActivationIntent } from "@/shared/api/backend/index.server";
import { z } from "zod";
import { telegramContinuationPath } from "../model/telegram-continuation";
import { TelegramContinuationPage } from "./telegram-continuation-page.client";

export async function TelegramContinuationRoute({
  attemptId,
}: {
  readonly attemptId: string;
}) {
  await redirectUntilTermsAccepted(telegramContinuationPath(attemptId));
  let product: { id: string; name: string; slug: string } | undefined;
  try {
    const result = await requestTelegramActivationIntent(attemptId);
    const intent = result.ok
      ? z
          .object({
            product: z.object({
              id: z.uuid(),
              name: z.string(),
              slug: z.string(),
            }),
          })
          .safeParse(result.body)
      : null;
    if (intent?.success === true) product = intent.data.product;
  } catch {
    /* Product metadata failure never establishes a session or a grant. */
  }
  return (
    <TelegramContinuationPage
      attemptId={attemptId}
      {...(product === undefined ? {} : { product })}
    />
  );
}
