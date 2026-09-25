import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { authorizeManager, type AuthorPolicy } from "../../ports/author-policy.js";
import {
  createGuideArtifact,
  removeGuideArtifact,
  replaceGuideArtifactContent,
  setGuideArtifactArchived,
  setGuideArtifactGuides,
  setGuideArtifactMaterials,
  updateGuideArtifact,
} from "./author-guide-artifacts.js";
import { assembleGuideArtifactFiles } from "./guide-artifact-files.js";
import type { GuideArtifactContext } from "./guide-artifact-records.js";
import type { GuideArtifacts } from "./guide-artifacts.js";
import { applyAuthoringImport } from "./import-guide-artifacts.js";
import {
  listGuideArtifacts,
  listReusableGuideArtifacts,
  loadGuideArtifactAccessFacts,
  loadGuideArtifactFileDelivery,
  loadReaderGuideArtifacts,
} from "./read-guide-artifacts.js";

export function assembleGuideArtifacts(dependencies: {
  readonly authorPolicy: AuthorPolicy;
  readonly objectStorage: ObjectStorage;
  readonly prisma: MaterialsPrismaClient;
}): GuideArtifacts {
  const context: GuideArtifactContext = {
    async authorize(actor) {
      const authorization = await authorizeManager(dependencies.authorPolicy, actor);
      return authorization.ok ? null : authorization.error;
    },
    files: assembleGuideArtifactFiles(dependencies.objectStorage),
    prisma: dependencies.prisma,
  };
  return Object.freeze({
    applyAuthoringImport: (command) => applyAuthoringImport(context, command),
    create: (command) => createGuideArtifact(context, command),
    listForGuide: (query) => listGuideArtifacts(context, query),
    listReusable: (query) => listReusableGuideArtifacts(context, query),
    loadAccessFacts: (artifactIds) => loadGuideArtifactAccessFacts(context, artifactIds),
    loadFileDelivery: (input) => loadGuideArtifactFileDelivery(context, input),
    loadForReader: (guideId) => loadReaderGuideArtifacts(context, guideId),
    remove: (command) => removeGuideArtifact(context, command),
    replaceContent: (command) => replaceGuideArtifactContent(context, command),
    setArchived: (command) => setGuideArtifactArchived(context, command),
    setGuides: (command) => setGuideArtifactGuides(context, command),
    setMaterials: (command) => setGuideArtifactMaterials(context, command),
    update: (command) => updateGuideArtifact(context, command),
  } satisfies GuideArtifacts);
}
