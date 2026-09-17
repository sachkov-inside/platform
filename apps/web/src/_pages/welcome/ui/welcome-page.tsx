import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { safeReturnPath, WelcomeScreen, WelcomeView } from "@/features/terms-acceptance";
import { readTermsGate } from "@/features/terms-acceptance.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { legalDocumentPath } from "@/shared/routing/public-page-path";
import { internalRoute } from "@/shared/routing/internal-route";

/**
 * Окно «Добро пожаловать»: открывается поверх сайта, пока у аккаунта нет принятия действующей
 * редакции условий. Гость и человек, который уже принял условия, сразу идут дальше.
 */
export async function WelcomePage({ returnTo, backdrop }: { readonly returnTo: string; readonly backdrop?: ReactNode }) {
  const target = safeReturnPath(returnTo);
  const gate = await readTermsGate(await getOptionalPlatformAccessToken());
  if (gate.kind === "guest" || gate.kind === "accepted") redirect(internalRoute(target));
  const privacyHref = legalDocumentPath("privacy");
  // The site stays visible behind the decision but cannot be used or read by assistive technology.
  const behind = backdrop === undefined ? null : <div aria-hidden="true" className="welcome-backdrop" inert>{backdrop}</div>;
  if (gate.kind === "unavailable")
    return (
      <>
      {behind}
      <WelcomeView
        privacyHref={privacyHref}
        returning={false}
        termsHref={legalDocumentPath("terms")}
        unavailable
      />
      </>
    );
  const { document, previouslyAccepted } = gate.status;
  return (
    <>
    {behind}
    <WelcomeScreen
      document={{ version: document.version, digest: document.digest }}
      privacyHref={privacyHref}
      returnTo={target}
      returning={previouslyAccepted}
      termsHref={internalRoute(new URL(document.url).pathname)}
    />
    </>
  );
}
