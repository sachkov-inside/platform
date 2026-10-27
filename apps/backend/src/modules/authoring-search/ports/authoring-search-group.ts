/**
 * One group of the authoring search (#1720): the hits of one kind that its owning Module finds for
 * one actor. The owner decides the actor's right to the group: a refusal omits the group, a failed
 * dependency answers it as unavailable, and the other groups still answer.
 *
 * Adding a group, for example «Люди»:
 *
 * 1. The owning Module implements the search behind its own right and exports it from its
 *    `index.ts`; its answer needs no type from this Module, only the matching shape.
 * 2. Add the ready variant to `AuthoringSearchReadyGroup` below.
 * 3. Add an adapter beside `adapters/products/products-search-group.ts` that maps the owner's
 *    hits field by field, and place it in the registry order of `authoring-search.module.ts`.
 * 4. Add the variant's HTTP schema to `readyGroupHttpSchema` in
 *    `features/search-authoring/search-authoring.controller.ts`, then run `pnpm api:generate`.
 */
export type AuthoringSearchReadyGroup =
  | {
      readonly kind: "products";
      readonly state: "ready";
      readonly items: readonly AuthoringSearchProduct[];
    }
  | {
      readonly kind: "materials";
      readonly state: "ready";
      readonly items: readonly AuthoringSearchMaterial[];
    }
  | {
      readonly kind: "payments";
      readonly state: "ready";
      readonly items: readonly AuthoringSearchPayment[];
    };

export type AuthoringSearchKind = AuthoringSearchReadyGroup["kind"];

/** A Product by name or slug; an archived Product is found too and flagged. */
export interface AuthoringSearchProduct {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

/** A Material by title, summary or slug, with the name of its Topic. */
export interface AuthoringSearchMaterial {
  readonly id: string;
  readonly title: string | null;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly topic: string | null;
}

/**
 * A payment by order number, bank payment number, exact amount or the person who paid (found by
 * the people directory); it names no person and no contact. `state` is the bank attempt state.
 */
export interface AuthoringSearchPayment {
  readonly purchaseRef: string;
  readonly productName: string;
  readonly amountKopecks: number;
  readonly state:
    | "prepared"
    | "sent"
    | "unknown"
    | "pending"
    | "authorized"
    | "confirmed"
    | "failed";
  readonly createdAt: string;
}

/** What one group search receives: the normalized text and the most hits to return. */
export interface AuthoringSearchRequest {
  readonly actor: string;
  readonly query: string;
  readonly limit: number;
}

/** A refusal omits the group; a dependency failure, already recorded by its owner, marks it unavailable. */
export type AuthoringGroupSearchError =
  | { readonly code: "forbidden" }
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };

export type AuthoringSearchGroup = {
  readonly [Kind in AuthoringSearchKind]: {
    readonly kind: Kind;
    readonly search: (request: AuthoringSearchRequest) => Promise<
      | {
          readonly ok: true;
          readonly value: Extract<AuthoringSearchReadyGroup, { kind: Kind }>;
        }
      | { readonly ok: false; readonly error: AuthoringGroupSearchError }
    >;
  };
}[AuthoringSearchKind];
