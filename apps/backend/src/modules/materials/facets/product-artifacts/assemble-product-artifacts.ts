import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  authorizeManager,
  type AuthorPolicy,
} from "../../ports/author-policy.js";
import {
  createProductArtifact,
  removeProductArtifact,
  replaceProductArtifactContent,
  setProductArtifactArchived,
  setProductArtifactProducts,
  setProductArtifactMaterials,
  updateProductArtifact,
} from "./author-product-artifacts.js";
import { assembleProductArtifactFiles } from "./product-artifact-files.js";
import type { ProductArtifactContext } from "./product-artifact-records.js";
import type { ProductArtifacts } from "./product-artifacts.js";
import { applyAuthoringImport } from "./import-product-artifacts.js";
import {
  listProductArtifacts,
  listReusableProductArtifacts,
  loadProductArtifactAccessFacts,
  loadProductArtifactFileDelivery,
  loadReaderProductArtifacts,
} from "./read-product-artifacts.js";

export function assembleProductArtifacts(dependencies: {
  readonly authorPolicy: AuthorPolicy;
  readonly objectStorage: ObjectStorage;
  readonly prisma: MaterialsPrismaClient;
}): ProductArtifacts {
  const context: ProductArtifactContext = {
    async authorize(actor) {
      const authorization = await authorizeManager(
        dependencies.authorPolicy,
        actor,
      );
      return authorization.ok ? null : authorization.error;
    },
    files: assembleProductArtifactFiles(dependencies.objectStorage),
    prisma: dependencies.prisma,
  };
  return Object.freeze({
    applyAuthoringImport: (command) => applyAuthoringImport(context, command),
    create: (command) => createProductArtifact(context, command),
    listForProduct: (query) => listProductArtifacts(context, query),
    listReusable: (query) => listReusableProductArtifacts(context, query),
    loadAccessFacts: (artifactIds) =>
      loadProductArtifactAccessFacts(context, artifactIds),
    loadFileDelivery: (input) =>
      loadProductArtifactFileDelivery(context, input),
    loadForReader: (productId) =>
      loadReaderProductArtifacts(context, productId),
    remove: (command) => removeProductArtifact(context, command),
    replaceContent: (command) =>
      replaceProductArtifactContent(context, command),
    setArchived: (command) => setProductArtifactArchived(context, command),
    setProducts: (command) => setProductArtifactProducts(context, command),
    setMaterials: (command) => setProductArtifactMaterials(context, command),
    update: (command) => updateProductArtifact(context, command),
  } satisfies ProductArtifacts);
}
