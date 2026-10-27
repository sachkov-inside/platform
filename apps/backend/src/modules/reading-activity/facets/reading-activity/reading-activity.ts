import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import type { PublishedProductComposition } from "../../../products/index.js";
import type { MaterialContent } from "../../../materials/index.js";
import { getReaderProductMode } from "../../features/get-reader-product-mode/get-reader-product-mode.js";
import { getReadingStates } from "../../features/get-reading-states/get-reading-states.js";
import { getProductProgress } from "../../features/get-product-progress/get-product-progress.js";
import { setReaderProductMode } from "../../features/set-reader-product-mode/set-reader-product-mode.js";
import { setReadingState } from "../../features/set-reading-state/set-reading-state.js";
import type { SetReadingStateCommand } from "../../features/set-reading-state/set-reading-state.contract.js";

export class ReadingActivity {
  constructor(
    private readonly dependencies: {
      readonly prisma: ReadingActivityPrismaClient;
      readonly contentAccess: Pick<
        ContentAccess,
        "authorize" | "checkProductAccess"
      >;
      readonly materialContent: Pick<MaterialContent, "findAccessFacts">;
      readonly composition: Pick<PublishedProductComposition, "read">;
    },
  ) {}

  setReadingState(command: SetReadingStateCommand) {
    return setReadingState(this.dependencies, command);
  }
  getReadingStates(query: {
    readonly accountId: string;
    readonly materialIds: readonly string[];
  }) {
    return getReadingStates(this.dependencies.prisma, query);
  }
  getProductProgress(query: {
    readonly accountId: string;
    readonly productId: string;
  }) {
    return getProductProgress(this.dependencies, query);
  }
  getReaderProductMode(query: { readonly accountId: string }) {
    return getReaderProductMode(this.dependencies.prisma, query);
  }
  setReaderProductMode(command: {
    readonly accountId: string;
    readonly productMode: unknown;
  }) {
    return setReaderProductMode(this.dependencies.prisma, command);
  }
}
