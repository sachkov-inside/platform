import { z } from "zod";

export const PRODUCT_ARTIFACTS = Symbol("PRODUCT_ARTIFACTS");

export const productArtifactAccessSchema = z.enum(["free", "closed"]);
export type ProductArtifactAccess = z.infer<typeof productArtifactAccessSchema>;

/**
 * Where the artifact record was first authored. `platform` records are owned by
 * the Platform editor; `authoring` records are owned by the Inside Content
 * authoring base and are the only ones an import may create or change.
 */
export type ProductArtifactOrigin = "authoring" | "platform";

export type ProductArtifactContent =
  | Readonly<{
      contentType: string;
      filename: string;
      kind: "file";
      size: number;
    }>
  | Readonly<{ externalUrl: string; kind: "link" }>;

export interface ProductArtifactDto {
  readonly access: ProductArtifactAccess;
  readonly archived: boolean;
  readonly artifactId: string;
  readonly content: ProductArtifactContent;
  readonly productIds: readonly string[];
  readonly materialIds: readonly string[];
  readonly origin: ProductArtifactOrigin;
  readonly purpose: string;
  readonly sourceId: string | null;
  readonly title: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type ProductArtifactError =
  | Readonly<{ code: "artifact_not_found" }>
  | Readonly<{ code: "artifact_referenced"; productIds: readonly string[] }>
  | Readonly<{ code: "dependency_unavailable"; retryable: true }>
  | Readonly<{ code: "forbidden" }>
  | Readonly<{ code: "product_not_found" }>
  | Readonly<{ code: "invalid_artifact" }>
  | Readonly<{ code: "invalid_content"; reason: string }>
  | Readonly<{ code: "material_not_found" }>
  | Readonly<{ code: "source_conflict" }>;

export type ProductArtifactResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: ProductArtifactError }>;

export interface UploadedArtifactFile {
  readonly body: Uint8Array;
  readonly declaredContentType: string;
  readonly declaredSize: number;
  readonly expectedChecksumSha256: string;
  readonly filename: string;
}

export interface ProductArtifactMetadataInput {
  readonly access: ProductArtifactAccess;
  readonly purpose: string;
  readonly title: string;
}

export type CreateProductArtifactCommand = Readonly<{
  actor: string;
  productId: string;
  metadata: ProductArtifactMetadataInput;
}> &
  (
    | Readonly<{ file: UploadedArtifactFile; kind: "file" }>
    | Readonly<{ externalUrl: string; kind: "link" }>
  );

export type ReplaceProductArtifactContentCommand = Readonly<{
  actor: string;
  artifactId: string;
}> &
  (
    | Readonly<{ file: UploadedArtifactFile; kind: "file" }>
    | Readonly<{ externalUrl: string; kind: "link" }>
  );

export interface UpdateProductArtifactCommand {
  readonly actor: string;
  readonly artifactId: string;
  readonly metadata: ProductArtifactMetadataInput;
}

export interface SetProductArtifactArchivedCommand {
  readonly actor: string;
  readonly archived: boolean;
  readonly artifactId: string;
}

export interface SetProductArtifactProductsCommand {
  readonly actor: string;
  readonly artifactId: string;
  readonly productIds: readonly string[];
}

export interface SetProductArtifactMaterialsCommand {
  readonly actor: string;
  readonly artifactId: string;
  readonly materialIds: readonly string[];
}

export interface RemoveProductArtifactCommand {
  readonly actor: string;
  readonly artifactId: string;
}

/** One current, ready artifact placed in a Product, before any access decision. */
export interface ReaderProductArtifact {
  readonly artifactId: string;
  readonly content: ProductArtifactContent;
  readonly purpose: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly version: number;
}

/** Storage facts for the current file version of one placed artifact. */
export interface ProductArtifactFileDelivery {
  readonly artifactId: string;
  readonly contentType: string;
  readonly filename: string;
  readonly object: Readonly<{
    protectedKey: string;
    publicKey: string | null;
  }>;
  readonly size: number;
}

export interface AuthoringProductArtifactSource {
  readonly access: ProductArtifactAccess;
  readonly externalUrl?: string;
  readonly file?: UploadedArtifactFile;
  readonly purpose: string;
  readonly sourceId: string;
  readonly title: string;
}

export interface ApplyAuthoringImportCommand {
  readonly actor: string;
  readonly artifacts: readonly AuthoringProductArtifactSource[];
  readonly productId: string;
  /** When present, the Product must belong to exactly this authoring source. */
  readonly productSourceId?: string;
}

/**
 * One authoring import outcome per artifact the package declares or the product
 * already carries from the authoring base. `diverged` and `missing` are
 * reported to the author instead of being applied. Records with
 * `origin = platform` never enter an import decision at all, so they never
 * appear here and an import can neither change nor archive them.
 */
export interface AuthoringImportOutcome {
  readonly artifactId: string;
  readonly outcome:
    "created" | "diverged" | "missing" | "unchanged" | "updated";
  readonly sourceId: string | null;
  readonly title: string;
}

export interface AuthoringImportReport {
  readonly outcomes: readonly AuthoringImportOutcome[];
}

export interface ProductArtifactAccessFacts {
  readonly access: ProductArtifactAccess;
  readonly archived: boolean;
  readonly artifactId: string;
  readonly productIds: readonly string[];
  readonly version: number;
}

export interface ProductArtifacts {
  create(
    command: CreateProductArtifactCommand,
  ): Promise<ProductArtifactResult<ProductArtifactDto>>;
  update(
    command: UpdateProductArtifactCommand,
  ): Promise<ProductArtifactResult<ProductArtifactDto>>;
  replaceContent(
    command: ReplaceProductArtifactContentCommand,
  ): Promise<ProductArtifactResult<ProductArtifactDto>>;
  setArchived(
    command: SetProductArtifactArchivedCommand,
  ): Promise<ProductArtifactResult<ProductArtifactDto>>;
  setProducts(
    command: SetProductArtifactProductsCommand,
  ): Promise<ProductArtifactResult<ProductArtifactDto>>;
  setMaterials(
    command: SetProductArtifactMaterialsCommand,
  ): Promise<ProductArtifactResult<ProductArtifactDto>>;
  remove(
    command: RemoveProductArtifactCommand,
  ): Promise<ProductArtifactResult<Readonly<{ artifactId: string }>>>;
  listForProduct(query: {
    readonly actor: string;
    readonly productId: string;
  }): Promise<ProductArtifactResult<readonly ProductArtifactDto[]>>;
  /** Every active artifact an author may reuse, whatever Product holds it. */
  listReusable(query: {
    readonly actor: string;
  }): Promise<ProductArtifactResult<readonly ProductArtifactDto[]>>;
  loadForReader(
    productId: string,
  ): Promise<ProductArtifactResult<readonly ReaderProductArtifact[]>>;
  loadFileDelivery(input: {
    readonly artifactId: string;
    readonly productId: string;
  }): Promise<ProductArtifactResult<ProductArtifactFileDelivery | null>>;
  applyAuthoringImport(
    command: ApplyAuthoringImportCommand,
  ): Promise<ProductArtifactResult<AuthoringImportReport>>;
  loadAccessFacts(
    artifactIds: readonly string[],
  ): Promise<readonly ProductArtifactAccessFacts[]>;
}
