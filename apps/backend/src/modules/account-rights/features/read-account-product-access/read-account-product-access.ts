import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { accessFailure } from "../../domain/access-grant.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-isolation.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import {
  readFirstAcquisitionOrigins,
  readSourceOrigins,
  type ProductAccessOrigin,
} from "../../shared/product-access-origins.js";

/** The Product Access bound of one Account, as capability resolution enforces it. */
const PRODUCT_ACCESS_LIMIT = 1000;
/** Sources and actions of one Account; a longer history is refused, never cut. */
const HISTORY_LIMIT = 10_000;

/**
 * Who recorded an event. `known` with `actorId: null` is the system: Billing confirmation,
 * Course Activation and the migration carry no Account. `unknown` is a manual issue whose action
 * cannot be told apart from another one recorded at the same instant.
 */
export type ProductAccessActor =
  | { readonly state: "known"; readonly actorId: string | null }
  | { readonly state: "unknown" };

export type ProductAccessEvent =
  | {
      readonly type: "source";
      /** `transfer` is a source moved from the historical access model. */
      readonly kind:
        "purchase" | "activation" | "manual_issue" | "transfer" | "other";
      readonly origin: ProductAccessOrigin;
      readonly sourceRef: string;
      readonly at: string;
      readonly actor: ProductAccessActor;
      readonly reason: string;
    }
  | {
      readonly type: "action";
      readonly id: string;
      readonly kind: "revoke" | "restore" | "migrate" | "other";
      readonly at: string;
      readonly actor: ProductAccessActor;
      readonly reason: string;
      readonly revision: number;
    };

export interface AccountProductAccess {
  readonly productId: string;
  readonly access: "active" | "revoked";
  readonly revision: number;
  readonly firstIssuedAt: string | null;
  /** How the Product Access was first acquired. */
  readonly origin: ProductAccessOrigin;
  /** Oldest first. */
  readonly history: readonly ProductAccessEvent[];
}

const SOURCE_KINDS: Readonly<
  Record<string, Extract<ProductAccessEvent, { type: "source" }>["kind"]>
> = {
  purchase: "purchase",
  course_activation: "activation",
  manual: "manual_issue",
  legacy: "transfer",
  migration_grant: "transfer",
};
const ACTION_KINDS: Readonly<
  Record<string, Extract<ProductAccessEvent, { type: "action" }>["kind"]>
> = { revoke: "revoke", restore: "restore", migrate: "migrate" };
/** Written in the same transaction as the source they acquire; folded into its event. */
const SOURCE_ACTION_KINDS = new Set(["issue", "source_recorded"]);

/**
 * Every Product Access of one Account with its sources and actions in one snapshot. An action
 * carries no source reference: a manual source and its `issue` or `source_recorded` action share
 * one instant (`issuedAt` equals `recordedAt`), and the actor is taken only when exactly one
 * action and exactly one source share it.
 */
export async function readAccountProductAccess(
  prisma: AccountRightsPrismaClient,
  input: string,
) {
  const parsed = z.uuid().toLowerCase().safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const accountId = parsed.data;
  const snapshot = await prisma.$transaction(async (tx) => {
    await setAccessSnapshotIsolation(tx);
    const access = await tx.productAccess.findMany({
      where: { accountId },
      orderBy: { productId: "asc" },
      take: PRODUCT_ACCESS_LIMIT + 1,
    });
    if (access.length === 0)
      return { access, origins: [], sources: [], actions: [] };
    const origins = await readFirstAcquisitionOrigins(
      tx,
      [accountId],
      PRODUCT_ACCESS_LIMIT + 1,
    );
    const sources = await readSourceOrigins(tx, accountId, HISTORY_LIMIT + 1);
    const actions = await tx.productAccessAction.findMany({
      where: { accountId },
      orderBy: [
        { productId: "asc" },
        { revision: "asc" },
        { recordedAt: "asc" },
        { id: "asc" },
      ],
      take: HISTORY_LIMIT + 1,
    });
    return { access, origins, sources, actions };
  });
  if (
    snapshot.access.length > PRODUCT_ACCESS_LIMIT ||
    snapshot.sources.length > HISTORY_LIMIT ||
    snapshot.actions.length > HISTORY_LIMIT
  )
    return dependencyFailure(
      { module: "account-rights", operation: "readAccountProductAccess" },
      new RangeError("Account Product Access history exceeds its bound"),
      accessFailure("unavailable"),
    );
  const products: AccountProductAccess[] = snapshot.access.map((row) => {
    const sources = snapshot.sources.filter(
      (source) => source.productId === row.productId,
    );
    const actions = snapshot.actions.filter(
      (action) => action.productId === row.productId,
    );
    const sourceActions = actions.filter((action) =>
      SOURCE_ACTION_KINDS.has(action.kind),
    );
    const history: ProductAccessEvent[] = [
      ...sources.map((source): ProductAccessEvent => {
        let actor: ProductAccessActor = { state: "known", actorId: null };
        if (source.source === "manual") {
          const at = source.issuedAt.getTime();
          const candidates = sourceActions.filter(
            (action) => action.recordedAt.getTime() === at,
          );
          const sharing = sources.filter(
            (other) => other.issuedAt.getTime() === at,
          );
          const [match] = candidates;
          actor =
            candidates.length === 1 &&
            sharing.length === 1 &&
            match !== undefined
              ? { state: "known", actorId: match.actorId }
              : { state: "unknown" };
        }
        return {
          type: "source",
          kind: SOURCE_KINDS[source.source] ?? "other",
          origin: source.origin,
          sourceRef: source.sourceRef,
          at: source.issuedAt.toISOString(),
          actor,
          reason: source.reason,
        };
      }),
      ...actions
        .filter((action) => !SOURCE_ACTION_KINDS.has(action.kind))
        .map((action): ProductAccessEvent => ({
          type: "action",
          id: action.id,
          kind: ACTION_KINDS[action.kind] ?? "other",
          at: action.recordedAt.toISOString(),
          actor: { state: "known", actorId: action.actorId },
          reason: action.reason,
          revision: action.revision,
        })),
    ];
    history.sort((left, right) => {
      const byTime = compareText(left.at, right.at);
      if (byTime !== 0) return byTime;
      if (left.type !== right.type) return left.type === "source" ? -1 : 1;
      return compareText(eventKey(left), eventKey(right));
    });
    return {
      productId: row.productId,
      access: row.revokedAt === null ? "active" : "revoked",
      revision: row.revision,
      firstIssuedAt: row.firstIssuedAt?.toISOString() ?? null,
      origin:
        snapshot.origins.find((origin) => origin.productId === row.productId)
          ?.origin ?? "unknown",
      history,
    };
  });
  return { ok: true as const, value: { accountId: input, products } };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function eventKey(event: ProductAccessEvent): string {
  return event.type === "source" ? event.sourceRef : event.id;
}
