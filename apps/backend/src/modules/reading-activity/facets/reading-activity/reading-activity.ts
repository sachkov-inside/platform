import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import type { PublishedProductComposition } from "../../../products/index.js";
import type { MaterialContent } from "../../../materials/index.js";
import { getReadingStates } from "../../features/get-reading-states/get-reading-states.js";
import { getProductProgress } from "../../features/get-product-progress/get-product-progress.js";
import { readLastActivity } from "../../features/read-last-activity/read-last-activity.js";
import { readLearningSummary } from "../../features/read-learning-summary/read-learning-summary.js";
import { readProductLearning } from "../../features/read-product-learning/read-product-learning.js";
import { summarizeProductLearning } from "../../features/summarize-product-learning/summarize-product-learning.js";
import { setReadingState } from "../../features/set-reading-state/set-reading-state.js";
import type { SetReadingStateCommand } from "../../features/set-reading-state/set-reading-state.contract.js";
import { recordOpenedParts } from "../../features/record-opened-parts/record-opened-parts.js";

export class ReadingActivity {
  constructor(
    private readonly dependencies: {
      readonly prisma: ReadingActivityPrismaClient;
      readonly contentAccess: Pick<
        ContentAccess,
        "authorize" | "checkProductAccess"
      >;
      readonly materialContent: Pick<
        MaterialContent,
        "findAccessFacts" | "findUpdateNotes"
      >;
      readonly composition: Pick<
        PublishedProductComposition,
        "read" | "readIncludingArchived"
      >;
    },
  ) {}

  setReadingState(command: SetReadingStateCommand) {
    return setReadingState(this.dependencies, command);
  }
  /** Step-by-step reveal (#2122): how many lesson parts the Account has opened; it only grows. */
  recordOpenedParts(command: {
    readonly accountId: string;
    readonly materialId: string;
    readonly openedParts: number;
  }) {
    return recordOpenedParts(this.dependencies, command);
  }
  getReadingStates(query: {
    readonly accountId: string;
    readonly materialIds: readonly string[];
  }) {
    return getReadingStates(this.dependencies, query);
  }
  getProductProgress(query: {
    readonly accountId: string;
    readonly productId: string;
  }) {
    return getProductProgress(this.dependencies, query);
  }
  /** Internal: no actor check, the caller checks the right to see these Accounts. */
  readProductLearning(query: {
    readonly productId: string;
    readonly accountIds: readonly string[];
  }) {
    return readProductLearning(this.dependencies, query);
  }
  /**
   * Started count and mean progress of up to 50 000 Accounts in one Product (#1719). Internal: no
   * actor check, the caller checks the right to see these Accounts.
   */
  summarizeProductLearning(query: {
    readonly productId: string;
    readonly accountIds: readonly string[];
  }) {
    return summarizeProductLearning(this.dependencies, query);
  }
  /**
   * The person card's learning facts per Product, over the published composition and without
   * the learner's access. No actor: the composing read checks its own right first.
   */
  readLearningSummary(accountId: string, productIds: readonly string[]) {
    return readLearningSummary(this.dependencies, { accountId, productIds });
  }
  /** The latest Material open per Account for one people page of at most 50. */
  readLastActivity(accountIds: readonly string[]) {
    return readLastActivity(this.dependencies.prisma, accountIds);
  }
}
