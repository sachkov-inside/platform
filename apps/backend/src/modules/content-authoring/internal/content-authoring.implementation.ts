import { randomUUID } from "node:crypto";

import type { PlatformDatabase } from "../../../infrastructure/postgres/index.js";
import type {
  ContentSchema,
} from "../../content-schema/index.js";
import type {
  ApplicationResult,
  ContentAuthoring,
  ContentAuthoringError,
  CreateDraftCommand,
  CreateDraftResult,
  DraftMetadata,
  DraftSnapshot,
  DraftWriteValue,
  LoadDraftQuery,
  LoadDraftResult,
  ReviseDraftCommand,
  ReviseDraftResult,
} from "../content-authoring.interface.js";
import type { AuthorPolicy } from "./author-policy.js";
import { fingerprintCommand } from "./canonical-command-fingerprint.js";
import {
  parseCreateDraftCommand,
  parseLoadDraftQuery,
  parseReviseDraftCommand,
} from "./command-rules.js";
import {
  advanceCurrentRevision,
  claimIdempotency,
  completeIdempotency,
  findReferenceIssues,
  findSeriesOrdinalConflict,
  insertMaterial,
  insertRevision,
  loadCurrentRevisionId,
  loadPersistedDraft,
  replaceCurrentRelations,
  toDraftSnapshot,
  type AuthoringTransaction,
  type PersistedDraftInput,
} from "./content-authoring.persistence.js";
import { validateMetadata } from "./material-rules.js";
import { mapPostgresError } from "./postgres-error-mapping.js";

class AuthoringRollback extends Error {
  constructor(readonly applicationError: ContentAuthoringError) {
    super(applicationError.code);
  }
}

function rollback(error: ContentAuthoringError): never {
  throw new AuthoringRollback(error);
}

function failure<Value>(error: ContentAuthoringError): ApplicationResult<Value> {
  return { ok: false, error };
}

export interface ContentAuthoringDependencies {
  readonly database: PlatformDatabase;
  readonly contentSchema: ContentSchema;
  readonly authorPolicy: AuthorPolicy;
}

export class ContentAuthoringImplementation implements ContentAuthoring {
  constructor(private readonly dependencies: ContentAuthoringDependencies) {}

  async createDraft(input: CreateDraftCommand): Promise<CreateDraftResult> {
    const parsedCommand = parseCreateDraftCommand(input);
    if (!parsedCommand.ok) {
      return failure(parsedCommand.error);
    }
    const command = parsedCommand.value;
    if (!(await this.canAuthor(command.actor))) {
      return failure({ code: "forbidden" });
    }
    const metadata = validateMetadata(command.metadata);
    if (!metadata.ok) {
      return failure(metadata.error);
    }
    const body = this.dependencies.contentSchema.acceptDocument(command.body, {
      assignMissingNodeIds: true,
    });
    if (!body.ok) {
      return failure(body.error);
    }

    const fingerprint = fingerprintCommand({
      operation: "create_draft",
      actor: command.actor,
      metadata: metadata.value,
      body: command.body,
    });
    try {
      const value = await this.dependencies.database.transaction().execute(async (transaction) => {
        const replay = await this.claimOrReplay(
          transaction,
          command.actor,
          "create_draft",
          command.idempotencyKey,
          fingerprint,
        );
        if (replay !== undefined) {
          return replay;
        }

        const materialId = randomUUID();
        const revisionId = randomUUID();
        await this.requireReferences(transaction, metadata.value);
        await this.requireAvailableSeriesOrdinals(
          transaction,
          materialId,
          metadata.value,
        );
        await insertMaterial(transaction, {
          materialId,
          revisionId,
          slug: metadata.value.slug,
        });
        await insertRevision(transaction, {
          actor: command.actor,
          materialId,
          revisionId,
          metadata: metadata.value,
          schemaVersion: body.value.schemaVersion,
          body: body.value.doc,
        });
        await replaceCurrentRelations(transaction, materialId, metadata.value);
        await completeIdempotency(transaction, {
          actor: command.actor,
          operation: "create_draft",
          key: command.idempotencyKey,
          materialId,
          revisionId,
        });
        return this.loadWriteValue(transaction, materialId, revisionId);
      });
      return { ok: true, value };
    } catch (error) {
      return failure(
        error instanceof AuthoringRollback
          ? error.applicationError
          : mapPostgresError(error, metadata.value),
      );
    }
  }

  async loadDraft(input: LoadDraftQuery): Promise<LoadDraftResult> {
    const parsedQuery = parseLoadDraftQuery(input);
    if (!parsedQuery.ok) {
      return failure(parsedQuery.error);
    }
    const query = parsedQuery.value;
    if (!(await this.canAuthor(query.actor))) {
      return failure({ code: "forbidden" });
    }
    try {
      const persisted = await loadPersistedDraft(this.dependencies.database, query.materialId);
      if (persisted === undefined) {
        return failure({ code: "material_not_found" });
      }
      const draft = this.hydratePersistedDraft(persisted);
      return draft.ok ? draft : failure(draft.error);
    } catch (error) {
      return failure(mapPostgresError(error));
    }
  }

  async reviseDraft(input: ReviseDraftCommand): Promise<ReviseDraftResult> {
    const parsedCommand = parseReviseDraftCommand(input);
    if (!parsedCommand.ok) {
      return failure(parsedCommand.error);
    }
    const command = parsedCommand.value;
    if (!(await this.canAuthor(command.actor))) {
      return failure({ code: "forbidden" });
    }

    let persistedBase: PersistedDraftInput | undefined;
    try {
      persistedBase = await loadPersistedDraft(
        this.dependencies.database,
        command.materialId,
        command.baseRevisionId,
      );
      if (persistedBase === undefined) {
        const currentRevisionId = await loadCurrentRevisionId(
          this.dependencies.database,
          command.materialId,
        );
        return currentRevisionId === undefined
          ? failure({ code: "material_not_found" })
          : failure({ code: "stale_revision", currentRevisionId });
      }
    } catch (error) {
      return failure(mapPostgresError(error));
    }

    const base = this.hydratePersistedDraft(persistedBase);
    if (!base.ok) {
      return failure(base.error);
    }
    const metadata = validateMetadata({
      ...base.value.metadata,
      ...command.changes.metadata,
    });
    if (!metadata.ok) {
      return failure(metadata.error);
    }
    const body =
      command.changes.body === undefined
        ? { ok: true as const, value: base.value.body }
        : this.dependencies.contentSchema.applyChanges(
            base.value.body,
            command.changes.body,
          );
    if (!body.ok) {
      return failure(body.error);
    }
    const fingerprint = fingerprintCommand({
      operation: "revise_draft",
      actor: command.actor,
      materialId: command.materialId,
      baseRevisionId: command.baseRevisionId,
      contentSchemaVersion: base.value.body.schemaVersion,
      changes: command.changes,
    });

    try {
      const value = await this.dependencies.database.transaction().execute(async (transaction) => {
        const replay = await this.claimOrReplay(
          transaction,
          command.actor,
          "revise_draft",
          command.idempotencyKey,
          fingerprint,
        );
        if (replay !== undefined) {
          return replay;
        }

        await this.requireReferences(transaction, metadata.value);
        await this.requireAvailableSeriesOrdinals(
          transaction,
          command.materialId,
          metadata.value,
        );

        const revisionId = randomUUID();
        await insertRevision(transaction, {
          actor: command.actor,
          materialId: command.materialId,
          revisionId,
          metadata: metadata.value,
          schemaVersion: body.value.schemaVersion,
          body: body.value.doc,
        });
        const advanced = await advanceCurrentRevision(transaction, {
          materialId: command.materialId,
          baseRevisionId: command.baseRevisionId,
          revisionId,
          slug: metadata.value.slug,
        });
        if (!advanced) {
          const currentRevisionId = await loadCurrentRevisionId(
            transaction,
            command.materialId,
          );
          if (currentRevisionId === undefined) {
            rollback({ code: "material_not_found" });
          }
          rollback({ code: "stale_revision", currentRevisionId });
        }
        await replaceCurrentRelations(transaction, command.materialId, metadata.value);
        await completeIdempotency(transaction, {
          actor: command.actor,
          operation: "revise_draft",
          key: command.idempotencyKey,
          materialId: command.materialId,
          revisionId,
        });
        return this.loadWriteValue(transaction, command.materialId, revisionId);
      });
      return { ok: true, value };
    } catch (error) {
      return failure(
        error instanceof AuthoringRollback
          ? error.applicationError
          : mapPostgresError(error, metadata.value),
      );
    }
  }

  private async canAuthor(actor: string): Promise<boolean> {
    try {
      return await this.dependencies.authorPolicy.canAuthor(actor);
    } catch {
      return false;
    }
  }

  private async requireReferences(
    transaction: AuthoringTransaction,
    metadata: DraftMetadata,
  ): Promise<void> {
    const issues = await findReferenceIssues(transaction, metadata);
    if (issues.length > 0) {
      rollback({ code: "invalid_reference", issues });
    }
  }

  private async requireAvailableSeriesOrdinals(
    transaction: AuthoringTransaction,
    materialId: string,
    metadata: DraftMetadata,
  ): Promise<void> {
    const conflict = await findSeriesOrdinalConflict(
      transaction,
      materialId,
      metadata,
    );
    if (conflict !== undefined) {
      rollback({ code: "series_ordinal_conflict", ...conflict });
    }
  }

  private async claimOrReplay(
    transaction: AuthoringTransaction,
    actor: string,
    operation: "create_draft" | "revise_draft",
    key: string,
    fingerprint: string,
  ): Promise<DraftWriteValue | undefined> {
    const claim = await claimIdempotency(transaction, {
      actor,
      operation,
      key,
      fingerprint,
    });
    if (claim.kind === "claimed") {
      return undefined;
    }
    if (claim.kind === "reused") {
      rollback({ code: "idempotency_key_reused" });
    }
    if (claim.kind === "incomplete") {
      rollback({ code: "internal_error", correlationId: randomUUID() });
    }
    return this.loadWriteValue(transaction, claim.materialId, claim.revisionId);
  }

  private async loadWriteValue(
    database: PlatformDatabase,
    materialId: string,
    revisionId: string,
  ): Promise<DraftWriteValue> {
    const persisted = await loadPersistedDraft(database, materialId, revisionId);
    if (persisted === undefined) {
      rollback({ code: "internal_error", correlationId: randomUUID() });
    }
    const draft = this.hydratePersistedDraft(persisted);
    if (!draft.ok) {
      rollback(draft.error);
    }
    return { materialId, revisionId, draft: draft.value };
  }

  private hydratePersistedDraft(
    persisted: PersistedDraftInput,
  ): ApplicationResult<DraftSnapshot> {
    const body = this.dependencies.contentSchema.acceptDocument({
      schemaVersion: persisted.schemaVersion,
      doc: persisted.body,
    });
    if (!body.ok) {
      return failure({ code: "internal_error", correlationId: randomUUID() });
    }
    return { ok: true, value: toDraftSnapshot(persisted, body.value) };
  }
}
