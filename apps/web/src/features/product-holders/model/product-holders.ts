import { z } from "zod";

/** At most this many Accounts in one pre-check read and in one bulk grant. */
export const PRODUCT_HOLDERS_ACCOUNT_LIMIT = 50;

export const holderAccessSchema = z.enum(["active", "revoked"]);
export type HolderAccess = z.infer<typeof holderAccessSchema>;

const cursorSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/u);

/** One holder of the Product: who, whether access is active, and how far they got. */
export const productHolderSchema = z
  .object({
    accountId: z.uuid(),
    access: holderAccessSchema,
    firstIssuedAt: z.iso.datetime({ offset: true }).nullable(),
    learning: z
      .object({
        readCount: z.number().int().nonnegative(),
        totalCount: z.number().int().nonnegative(),
        startedAt: z.iso.datetime({ offset: true }).nullable(),
        lastActivityAt: z.iso.datetime({ offset: true }).nullable(),
      })
      .strict(),
  })
  .strict();
export type ProductHolder = z.infer<typeof productHolderSchema>;

/**
 * The holders read as the page sees it. A refusal is its own outcome and never an empty page:
 * an author without the access right must not read «учеников нет».
 */
export type ProductHoldersState =
  | {
      readonly kind: "ready";
      readonly items: readonly ProductHolder[];
      readonly nextCursor: string | null;
    }
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_request" }
  | { readonly kind: "unavailable"; readonly reference: string };

export const productHoldersStateSchema: z.ZodType<ProductHoldersState> =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("ready"),
        items: z.array(productHolderSchema),
        nextCursor: cursorSchema.nullable(),
      })
      .strict(),
    z.object({ kind: z.literal("signed_out") }).strict(),
    z.object({ kind: z.literal("forbidden") }).strict(),
    z.object({ kind: z.literal("not_found") }).strict(),
    z.object({ kind: z.literal("invalid_request") }).strict(),
    z
      .object({ kind: z.literal("unavailable"), reference: z.string() })
      .strict(),
  ]);

/** One holders read: a page of the list, or the access of up to 50 chosen Accounts. */
export interface ProductHoldersQuery {
  readonly productId: string;
  readonly cursor?: string;
  readonly access?: HolderAccess;
  readonly accountIds?: readonly string[];
}

const querySchema = z
  .object({
    productId: z.uuid(),
    cursor: cursorSchema.optional(),
    access: holderAccessSchema.optional(),
    accountIds: z
      .array(z.uuid())
      .min(1)
      .max(PRODUCT_HOLDERS_ACCOUNT_LIMIT)
      .optional(),
  })
  .strict();

/** The search part of the BFF address; the Product is in the path. Stable for query keys. */
export function productHoldersSearch(query: ProductHoldersQuery): string {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.access !== undefined) params.set("access", query.access);
  for (const accountId of query.accountIds ?? [])
    params.append("accountIds", accountId);
  return params.toString();
}

/** The BFF reads its own address back; anything outside the contract is `null`. */
export function parseProductHoldersSearch(
  productId: string,
  params: URLSearchParams,
): ProductHoldersQuery | null {
  const accountIds = params.getAll("accountIds");
  const parsed = querySchema.safeParse({
    productId,
    ...(params.has("cursor") ? { cursor: params.get("cursor") } : {}),
    ...(params.has("access") ? { access: params.get("access") } : {}),
    ...(accountIds.length === 0 ? {} : { accountIds }),
  });
  if (!parsed.success) return null;
  const known = new Set(["cursor", "access", "accountIds"]);
  for (const key of params.keys()) if (!known.has(key)) return null;
  const { cursor, access, accountIds: ids } = parsed.data;
  return {
    productId: parsed.data.productId,
    ...(cursor === undefined ? {} : { cursor }),
    ...(access === undefined ? {} : { access }),
    ...(ids === undefined ? {} : { accountIds: ids }),
  };
}

/** The learners tab keeps its page and filter in the product page address. */
export interface HoldersAddress {
  readonly cursor?: string;
  readonly access?: HolderAccess;
}

/** Reads `?cursor=` and `?access=`; a value that is not ours opens the first page unfiltered. */
export function readHoldersAddress(params: URLSearchParams): HoldersAddress {
  const cursor = cursorSchema.safeParse(params.get("cursor"));
  const access = holderAccessSchema.safeParse(params.get("access"));
  return {
    ...(cursor.success ? { cursor: cursor.data } : {}),
    ...(access.success ? { access: access.data } : {}),
  };
}

/**
 * The product page address with this tab, page and filter. Other parameters stay. A cursor is
 * bound to its filter, so a filter change always starts from the first page.
 */
export function holdersAddressSearch(
  currentSearch: string,
  next: HoldersAddress,
): string {
  const params = new URLSearchParams(currentSearch);
  params.set("tab", "learners");
  if (next.cursor === undefined) params.delete("cursor");
  else params.set("cursor", next.cursor);
  if (next.access === undefined) params.delete("access");
  else params.set("access", next.access);
  return `?${params.toString()}`;
}
