import type { GuideTasksPrismaClient } from "../../../infrastructure/prisma/index.js";
import type { GuideDirectory } from "../../materials/index.js";
import type { TelegramAccountLinks } from "../../telegram-membership/index.js";
import type { AuthorPolicy } from "../ports/author-policy.js";

/** What the author's «Сдачи» section reads and writes (#948). */
export interface SubmissionReviewDependencies {
  readonly prisma: GuideTasksPrismaClient;
  readonly directory: Pick<GuideDirectory, "guides">;
  readonly authorPolicy: AuthorPolicy;
  /** The person behind a submission, as «Люди и доступ» shows them: Account and Telegram. */
  readonly identities: Pick<TelegramAccountLinks, "readBinding">;
  readonly clock?: () => Date;
}
