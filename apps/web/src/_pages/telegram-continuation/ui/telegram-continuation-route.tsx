import { redirectUntilTermsAccepted } from "@/features/terms-acceptance.server";
import { telegramContinuationPath } from "../model/telegram-continuation";
import { TelegramContinuationPage } from "./telegram-continuation-page.client";

export async function TelegramContinuationRoute({
  attemptId,
}: {
  readonly attemptId: string;
}) {
  await redirectUntilTermsAccepted(telegramContinuationPath(attemptId));
  return <TelegramContinuationPage attemptId={attemptId} />;
}
