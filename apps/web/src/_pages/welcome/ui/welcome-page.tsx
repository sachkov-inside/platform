import { redirect } from "next/navigation";

import { safeReturnPath, WelcomeScreen, WelcomeView } from "@/features/terms-acceptance";
import { readTermsGate } from "@/features/terms-acceptance.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { legalDocumentPath } from "@/shared/routing/public-page-path";
import { internalRoute } from "@/shared/routing/internal-route";

/**
 * Экран «Добро пожаловать»: открывается, пока у аккаунта нет принятия действующей редакции условий.
 * Гость и человек, который уже принял условия, сразу идут дальше.
 */
export async function WelcomePage({ returnTo }: { readonly returnTo: string }) {
  const target = safeReturnPath(returnTo);
  const gate = await readTermsGate(await getOptionalPlatformAccessToken());
  if (gate.kind === "guest" || gate.kind === "accepted") redirect(internalRoute(target));
  const privacyHref = legalDocumentPath("privacy");
  if (gate.kind === "unavailable")
    return (
      <WelcomeView
        privacyHref={privacyHref}
        returning={false}
        termsHref={legalDocumentPath("terms")}
        unavailable
      />
    );
  const { document, previouslyAccepted } = gate.status;
  return (
    <WelcomeScreen
      document={{ version: document.version, digest: document.digest }}
      privacyHref={privacyHref}
      returnTo={target}
      returning={previouslyAccepted}
      termsHref={internalRoute(new URL(document.url).pathname)}
    />
  );
}
