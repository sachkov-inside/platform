import type { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { PublicContentTargets } from "../../../materials/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import type { contentValidationRequestSchema } from "../../communications-schema.generated.js";
import { authorizeAuthor } from "../authorize-author/authorize-author.js";
import { validateTargets } from "../validate-targets/validate-targets.js";

/** Checks the supplied snapshot without calling Telegram while its author transaction is open. */
export async function validateAuthorContent(
  dependencies: {
    readonly accounts: Accounts;
    readonly links: TelegramAccountLinks;
    readonly botIdentity: string;
    readonly publicOrigin: string | undefined;
    readonly targets: PublicContentTargets;
  },
  request: z.infer<typeof contentValidationRequestSchema>,
) {
  const authorization = await authorizeAuthor(dependencies, request);
  if (authorization.status !== "allowed") return authorization;
  if (!dependencies.publicOrigin) return { status: "unavailable" } as const;
  try {
    const targetErrors = await validateTargets(
      request.parts,
      dependencies.publicOrigin,
      dependencies.targets,
    );
    return { ...authorization, status: "ok", targetErrors } as const;
  } catch {
    return { status: "unavailable" } as const;
  }
}
