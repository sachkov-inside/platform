import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { z } from "zod";
import { productCapability } from "@inside/access-capabilities";
import { currentBillingSchema } from "@/entities/subscription";
import {
  readProductAccess,
  readProductSalePresentation,
} from "@/entities/subscription.sale.server";
import { getSeriesContinuation } from "@/features/reading-progress.server";
import { communityEntrySchema } from "@/features/community-entry";
import {
  requestCurrentBilling,
  requestCurrentCommunityEntry,
  requestProductWaitlistIntake,
  requestProductWaitlistMembership,
} from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

const intakeSchema = z.object({ intakeId: z.uuid(), name: z.string() });
const membershipSchema = intakeSchema.extend({ active: z.boolean() });

/** Request-local projection. React cache shares it only between slots in the same render;
 * connection stops prefetch before identity, and every transport read remains no-store. */
export const readProductReaderState = cache(
  async (productId: string, slug: string) => {
    await connection();
    const token = await getOptionalPlatformAccessToken();
    const access =
      token === undefined
        ? "closed"
        : await readProductAccess(productId, token);
    const presentation = Promise.all([
      readProductSalePresentation(productId, access, token),
      readWaitlist(productId, token),
    ]).then(([sale, waitlist]) => ({ sale, waitlist }));
    const common = { productId, slug, access, signedIn: token !== undefined };
    if (access === "open" && token !== undefined) {
      const onboarding = readOnboarding(productId, token);
      const continuation = await getSeriesContinuation(slug, token);
      return {
        ...common,
        kind: "learning",
        continuation,
        onboarding,
        presentation,
      } as const;
    }
    const { sale, waitlist } = await presentation;
    const selling = { ...common, sale, waitlist };
    if (access === "unknown") return { ...selling, kind: "checking" } as const;
    if (sale.kind === "unavailable")
      return { ...selling, kind: "unavailable" } as const;
    if (sale.sold) return { ...selling, kind: "sale" } as const;
    if (waitlist.kind === "ready")
      return { ...selling, kind: "waitlist" } as const;
    return {
      ...selling,
      kind: waitlist.kind === "unavailable" ? "unavailable" : "sale",
    } as const;
  },
);
export type ProductReaderState = Awaited<
  ReturnType<typeof readProductReaderState>
>;

async function readWaitlist(productId: string, token?: string) {
  try {
    const response = await (token === undefined
      ? requestProductWaitlistIntake(productId)
      : requestProductWaitlistMembership(productId, token));
    if (!response.ok)
      return {
        kind: response.response.status === 404 ? "absent" : "unavailable",
      } as const;
    const parsed = (
      token === undefined ? intakeSchema : membershipSchema
    ).safeParse(response.body);
    return parsed.success
      ? ({
          kind: "ready",
          ...parsed.data,
          active: "active" in parsed.data && parsed.data.active === true,
        } as const)
      : ({ kind: "unavailable" } as const);
  } catch {
    return { kind: "unavailable" } as const;
  }
}
async function readOnboarding(productId: string, token: string) {
  try {
    const response = await requestCurrentBilling(token);
    const billing = response.ok
      ? currentBillingSchema.safeParse(response.body)
      : null;
    if (billing?.success !== true) return { kind: "unavailable" } as const;
    const paid = billing.data.access.grounds.some(
      (ground) =>
        ground.active &&
        ground.source === "paid" &&
        ground.capabilities.includes(productCapability(productId)),
    );
    if (!paid) return { kind: "none", billing: billing.data } as const;
    const community = await requestCurrentCommunityEntry(token, productId);
    const entry = community.ok
      ? communityEntrySchema.safeParse(community.body)
      : null;
    return entry?.success === true
      ? ({ kind: "ready", entry: entry.data, billing: billing.data } as const)
      : ({ kind: "unavailable" } as const);
  } catch {
    return { kind: "unavailable" } as const;
  }
}
