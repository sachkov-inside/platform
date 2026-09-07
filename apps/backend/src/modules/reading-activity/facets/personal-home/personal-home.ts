import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import type { MaterialContent, PublishedMaterialSelection } from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
import { recordMaterialOpen, type RecordMaterialOpenInput } from "../../features/record-material-open/record-material-open.js";
import { getContinueMaterials } from "../../features/get-continue-materials/get-continue-materials.js";
export class PersonalHome {
  constructor(private readonly dependencies: {
    readonly prisma: ReadingActivityPrismaClient;
    readonly contentAccess: Pick<ContentAccess, "authorize" | "checkAvailabilityMany">;
    readonly materialContent: Pick<MaterialContent, "findAccessFacts">;
    readonly selection: Pick<PublishedMaterialSelection, "read">;
    readonly videos: Pick<Videos, "loadReadyDurations" | "loadProgressMany">;
  }) {}
  recordOpen(input: RecordMaterialOpenInput) { return recordMaterialOpen(this.dependencies, input); }
  getContinue(accountId: string) { return getContinueMaterials(this.dependencies, accountId); }
}
