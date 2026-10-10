import type { ProductTasksPrismaClient } from "../../../infrastructure/prisma/index.js";
import type { ProductDirectory } from "../../materials/index.js";
import type { TelegramAccountLinks } from "../../telegram-membership/index.js";
import type { AuthorPolicy } from "../ports/author-policy.js";

/** What the author's «Сдачи» section reads and writes (#948). */
export interface SubmissionReviewDependencies {
  readonly prisma: ProductTasksPrismaClient;
  readonly directory: Pick<ProductDirectory, "products">;
  readonly authorPolicy: AuthorPolicy;
  /** The person behind a submission, as «Люди и доступ» shows them: Account and Telegram. */
  readonly identities: Pick<TelegramAccountLinks, "readBinding">;
  readonly clock?: () => Date;
}
