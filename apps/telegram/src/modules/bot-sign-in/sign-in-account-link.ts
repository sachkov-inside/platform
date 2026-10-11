import { reserveSignInLink } from "../identity-linking/sign-in-link.js";
import { isTruthy } from "../../shared/truthiness.js";
import { hasText } from "../../shared/text.js";
import { Inject, Injectable } from "@nestjs/common";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { DATABASE, type Database } from "../../database/database.js";
import { CLOCK, type Clock } from "../../shared/clock.js";
import { IdentityLinking } from "../identity-linking/identity-linking.js";
import { isRequestRef } from "./bot-sign-in.js";

import { queueSignInResult } from "./queue-sign-in-result.js";

/** Finalizes an already consumed proof for the Account selected by the trusted Platform. */
@Injectable()
export class SignInAccountLink {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IdentityLinking) private readonly linking: IdentityLinking,
  ) {}

  async bind(requestRef: string, subjectRef: string, accountRef: string) {
    if (!isTruthy(this.config.signInEnabled))
      return { status: "disabled" } as const;
    if (![requestRef, subjectRef, accountRef].every(isRequestRef))
      return { status: "unavailable" } as const;
    const accepted = await this.database
      .transaction()
      .execute(async (transaction) => {
        const request = await transaction
          .selectFrom("sign_in_requests")
          .selectAll()
          .where("request_ref", "=", requestRef)
          .where("bot_identity", "=", this.config.botIdentity)
          .forUpdate()
          .executeTakeFirst();
        if (request?.state !== "consumed" || !hasText(request.telegram_user_id))
          return false;
        if (
          request.source === "mini-app" &&
          this.config.miniAppEnabled !== true
        )
          return false;
        const subject = await transaction
          .selectFrom("sign_in_subjects")
          .select("subject_ref")
          .where("bot_identity", "=", request.bot_identity)
          .where("telegram_user_id", "=", request.telegram_user_id)
          .executeTakeFirst();
        if (subject?.subject_ref !== subjectRef) return false;
        const now = this.clock.now();
        const reserved = await reserveSignInLink(transaction, {
          requestRef,
          accountRef,
          tokenDigest: request.start_token_digest,
          expiresAt: request.expires_at,
          botIdentity: request.bot_identity,
          telegramUserId: request.telegram_user_id,
          now,
        });
        if (!reserved) return false;
        await queueSignInResult(
          transaction,
          requestRef,
          now,
          "Вход подтверждён. Вернитесь на сайт.",
          this.config.signInReturnUrl,
        );
        return true;
      });
    if (!accepted) return { status: "unavailable" } as const;
    const result = await this.linking.confirm({
      accountRef,
      linkTransactionRef: requestRef,
      returnCorrelation: requestRef,
    });
    if (result.status !== "linked" && result.status !== "idempotent")
      return { status: "conflict" } as const;
    return {
      status: "linked",
      telegramIdentityRef: result.telegramIdentityRef,
    } as const;
  }
}
