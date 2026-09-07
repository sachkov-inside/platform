import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import type { MaterialContent, PublishedSeriesComposition } from "../../../materials/index.js";
import { getReadingStates } from "../../features/get-reading-states/get-reading-states.js";
import { getSeriesProgress } from "../../features/get-series-progress/get-series-progress.js";
import { setReadingState } from "../../features/set-reading-state/set-reading-state.js";
import type { SetReadingStateCommand } from "../../features/set-reading-state/set-reading-state.contract.js";

export class ReadingActivity {
  constructor(private readonly dependencies: {
    readonly prisma: ReadingActivityPrismaClient;
    readonly contentAccess: Pick<ContentAccess, "authorize">;
    readonly materialContent: Pick<MaterialContent, "findAccessFacts">;
    readonly composition: Pick<PublishedSeriesComposition, "read">;
  }) {}

  setReadingState(command: SetReadingStateCommand) { return setReadingState(this.dependencies, command); }
  getReadingStates(query: { readonly accountId: string; readonly materialIds: readonly string[] }) {
    return getReadingStates(this.dependencies.prisma, query);
  }
  getSeriesProgress(query: { readonly accountId: string; readonly seriesId: string }) {
    return getSeriesProgress(this.dependencies, query);
  }
}
