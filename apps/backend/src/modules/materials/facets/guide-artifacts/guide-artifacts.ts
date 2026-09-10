import { z } from "zod";

export const GUIDE_ARTIFACTS = Symbol("GUIDE_ARTIFACTS");

export const guideArtifactAccessSchema = z.enum(["free", "membership"]);
export type GuideArtifactAccess = z.infer<typeof guideArtifactAccessSchema>;

/**
 * Where the artifact record was first authored. `platform` records are owned by
 * the Platform editor; `authoring` records are owned by the Inside Content
 * authoring base and are the only ones an import may create or change.
 */
export type GuideArtifactOrigin = "authoring" | "platform";

export type GuideArtifactContent =
  | Readonly<{
      contentType: string;
      filename: string;
      kind: "file";
      size: number;
    }>
  | Readonly<{ externalUrl: string; kind: "link" }>;

export interface GuideArtifactDto {
  readonly access: GuideArtifactAccess;
  readonly archived: boolean;
  readonly artifactId: string;
  readonly content: GuideArtifactContent;
  readonly guideIds: readonly string[];
  readonly materialIds: readonly string[];
  readonly origin: GuideArtifactOrigin;
  readonly purpose: string;
  readonly sourceId: string | null;
  readonly title: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type GuideArtifactError =
  | Readonly<{ code: "artifact_not_found" }>
  | Readonly<{ code: "artifact_referenced"; guideIds: readonly string[] }>
  | Readonly<{ code: "dependency_unavailable"; retryable: true }>
  | Readonly<{ code: "forbidden" }>
  | Readonly<{ code: "guide_not_found" }>
  | Readonly<{ code: "invalid_artifact" }>
  | Readonly<{ code: "invalid_content"; reason: string }>
  | Readonly<{ code: "material_not_found" }>
  | Readonly<{ code: "source_conflict" }>;

export type GuideArtifactResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: GuideArtifactError }>;

export interface UploadedArtifactFile {
  readonly body: Uint8Array;
  readonly declaredContentType: string;
  readonly declaredSize: number;
  readonly expectedChecksumSha256: string;
  readonly filename: string;
}

export interface GuideArtifactMetadataInput {
  readonly access: GuideArtifactAccess;
  readonly purpose: string;
  readonly title: string;
}

export type CreateGuideArtifactCommand = Readonly<{
  actor: string;
  guideId: string;
  metadata: GuideArtifactMetadataInput;
}> &
  (
    | Readonly<{ file: UploadedArtifactFile; kind: "file" }>
    | Readonly<{ externalUrl: string; kind: "link" }>
  );

export type ReplaceGuideArtifactContentCommand = Readonly<{
  actor: string;
  artifactId: string;
}> &
  (
    | Readonly<{ file: UploadedArtifactFile; kind: "file" }>
    | Readonly<{ externalUrl: string; kind: "link" }>
  );

export interface UpdateGuideArtifactCommand {
  readonly actor: string;
  readonly artifactId: string;
  readonly metadata: GuideArtifactMetadataInput;
}

export interface SetGuideArtifactArchivedCommand {
  readonly actor: string;
  readonly archived: boolean;
  readonly artifactId: string;
}

export interface SetGuideArtifactGuidesCommand {
  readonly actor: string;
  readonly artifactId: string;
  readonly guideIds: readonly string[];
}

export interface SetGuideArtifactMaterialsCommand {
  readonly actor: string;
  readonly artifactId: string;
  readonly materialIds: readonly string[];
}

export interface RemoveGuideArtifactCommand {
  readonly actor: string;
  readonly artifactId: string;
}

/** One current, ready artifact placed in a Guide, before any access decision. */
export interface ReaderGuideArtifact {
  readonly artifactId: string;
  readonly content: GuideArtifactContent;
  readonly purpose: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly version: number;
}

/** Storage facts for the current file version of one placed artifact. */
export interface GuideArtifactFileDelivery {
  readonly artifactId: string;
  readonly contentType: string;
  readonly filename: string;
  readonly object: Readonly<{
    protectedKey: string;
    publicKey: string | null;
  }>;
  readonly size: number;
}

export interface AuthoringGuideArtifactSource {
  readonly access: GuideArtifactAccess;
  readonly externalUrl?: string;
  readonly file?: UploadedArtifactFile;
  readonly purpose: string;
  readonly sourceId: string;
  readonly title: string;
}

export interface ApplyAuthoringImportCommand {
  readonly actor: string;
  readonly artifacts: readonly AuthoringGuideArtifactSource[];
  readonly guideId: string;
}

/**
 * One authoring import outcome per artifact the package declares or the guide
 * already carries from the authoring base. `diverged` and `missing` are
 * reported to the author instead of being applied. Records with
 * `origin = platform` never enter an import decision at all, so they never
 * appear here and an import can neither change nor archive them.
 */
export interface AuthoringImportOutcome {
  readonly artifactId: string;
  readonly outcome: "created" | "diverged" | "missing" | "unchanged" | "updated";
  readonly sourceId: string | null;
  readonly title: string;
}

export interface AuthoringImportReport {
  readonly outcomes: readonly AuthoringImportOutcome[];
}

export interface GuideArtifactAccessFacts {
  readonly access: GuideArtifactAccess;
  readonly archived: boolean;
  readonly artifactId: string;
  readonly guideIds: readonly string[];
  readonly version: number;
}

export interface GuideArtifacts {
  create(
    command: CreateGuideArtifactCommand,
  ): Promise<GuideArtifactResult<GuideArtifactDto>>;
  update(
    command: UpdateGuideArtifactCommand,
  ): Promise<GuideArtifactResult<GuideArtifactDto>>;
  replaceContent(
    command: ReplaceGuideArtifactContentCommand,
  ): Promise<GuideArtifactResult<GuideArtifactDto>>;
  setArchived(
    command: SetGuideArtifactArchivedCommand,
  ): Promise<GuideArtifactResult<GuideArtifactDto>>;
  setGuides(
    command: SetGuideArtifactGuidesCommand,
  ): Promise<GuideArtifactResult<GuideArtifactDto>>;
  setMaterials(
    command: SetGuideArtifactMaterialsCommand,
  ): Promise<GuideArtifactResult<GuideArtifactDto>>;
  remove(
    command: RemoveGuideArtifactCommand,
  ): Promise<GuideArtifactResult<Readonly<{ artifactId: string }>>>;
  listForGuide(query: {
    readonly actor: string;
    readonly guideId: string;
  }): Promise<GuideArtifactResult<readonly GuideArtifactDto[]>>;
  /** Every active artifact an author may reuse, whatever Guide holds it. */
  listReusable(query: {
    readonly actor: string;
  }): Promise<GuideArtifactResult<readonly GuideArtifactDto[]>>;
  loadForReader(
    guideId: string,
  ): Promise<GuideArtifactResult<readonly ReaderGuideArtifact[]>>;
  loadFileDelivery(input: {
    readonly artifactId: string;
    readonly guideId: string;
  }): Promise<GuideArtifactResult<GuideArtifactFileDelivery | null>>;
  applyAuthoringImport(
    command: ApplyAuthoringImportCommand,
  ): Promise<GuideArtifactResult<AuthoringImportReport>>;
  loadAccessFacts(
    artifactIds: readonly string[],
  ): Promise<readonly GuideArtifactAccessFacts[]>;
}
