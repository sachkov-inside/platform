import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import {
  handleMutationOperation,
  handleOptionalMutationOperation,
  handleAuthenticatedRead,
  readLogtoBffConfig,
  readAuthenticatedSession,
} from "@/shared/auth/index.server";
import {
  requestProductWaitlistIntake,
  requestProductWaitlistMembership,
  requestJoinProductWaitlist,
  requestWithdrawProductWaitlist,
  resolveAccount,
} from "@/shared/api/backend/index.server";
import {
  signWaitlistIntent,
  verifyWaitlistIntent,
  WAITLIST_INTENT_COOKIE,
  WAITLIST_INTENT_LIFETIME_SECONDS,
} from "@/features/product-waitlist.intent.server";
import {
  beginWaitlistIntentOperation,
  joinWaitlistOperation,
  withdrawWaitlistOperation,
} from "@/features/product-waitlist.operations";
const intakeSchema = z.strictObject({ intakeId: z.uuid(), name: z.string() });
const membershipSchema = intakeSchema.extend({ active: z.boolean() });
const sourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/u);
const unavailable = () => ({ kind: "unavailable" }) as const;

export async function handleWaitlistRead(request: Request): Promise<Response> {
  await connection();
  const productId = z
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("productId")).data;
  if (productId === undefined)
    return Response.json(unavailable(), { status: 400 });
  const session = await readAuthenticatedSession("route");
  if (session.kind === "authentication_required")
    return Response.json(
      { kind: "guest" },
      { headers: { "cache-control": "private, no-store", vary: "cookie" } },
    );
  return handleAuthenticatedRead(async (accessToken) => {
    const result = await requestProductWaitlistMembership(
      productId,
      accessToken,
    );
    if (!result.ok)
      return Response.json(unavailable(), { status: result.response.status });
    const parsed = membershipSchema.safeParse(result.body);
    if (!parsed.success) return Response.json(unavailable(), { status: 502 });
    const config = readLogtoBffConfig();
    const intent = verifyWaitlistIntent(
      (await cookies()).get(WAITLIST_INTENT_COOKIE)?.value,
      config.cookieSecret,
      new Date(),
    );
    return Response.json({
      kind: "ready",
      ...parsed.data,
      continuation: intent?.productId === productId && intent.phase === "ready",
      accountId: (await resolveAccount(accessToken)).accountId,
    });
  });
}
export function handleWaitlistIntent(request: Request): Promise<Response> {
  return handleOptionalMutationOperation(
    request,
    beginWaitlistIntentOperation,
    {
      invalidInput: () => Response.json(unavailable(), { status: 400 }),
      execute: async ({ productId, source }, accessToken) => {
        const result = await requestProductWaitlistIntake(productId);
        if (!result.ok)
          return Response.json(unavailable(), {
            status: result.response.status,
          });
        const intake = intakeSchema.safeParse(result.body);
        if (!intake.success)
          return Response.json(unavailable(), { status: 502 });
        const account =
          accessToken === undefined ? null : await resolveAccount(accessToken);
        const config = readLogtoBffConfig();
        const now = new Date();
        const token = signWaitlistIntent(
          {
            productId,
            intakeId: intake.data.intakeId,
            accountId: account?.accountId ?? null,
            source: sourceSchema.safeParse(source).data ?? null,
          },
          config.cookieSecret,
          now,
        );
        (await cookies()).set(WAITLIST_INTENT_COOKIE, token, {
          httpOnly: true,
          sameSite: "lax",
          secure: config.cookieSecure,
          path: "/",
          maxAge: WAITLIST_INTENT_LIFETIME_SECONDS,
        });
        return Response.json({
          kind: accessToken === undefined ? "sign-in" : "continue",
          returnTo: `/products/ai-engineering?waitlist=${verifyWaitlistIntent(token, config.cookieSecret, now)?.operationId ?? ""}`,
        });
      },
    },
  );
}
export function handleWaitlistJoin(request: Request): Promise<Response> {
  return handleMutationOperation(request, joinWaitlistOperation, {
    // Без продукта не совпадёт ни одно намерение: как и раньше, это истёкшее приглашение.
    invalidInput: () => ({ kind: "expired" }),
    execute: async ({ productId }, accessToken) => {
      const config = readLogtoBffConfig();
      const store = await cookies();
      const intent = verifyWaitlistIntent(
        store.get(WAITLIST_INTENT_COOKIE)?.value,
        config.cookieSecret,
        new Date(),
      );
      if (
        intent?.phase !== "ready" ||
        intent.productId !== productId ||
        intent.accountId === null
      )
        return { kind: "expired" };
      const account = await resolveAccount(accessToken);
      if (intent.accountId !== account.accountId) return { kind: "expired" };
      const result = await requestJoinProductWaitlist(
        {
          intakeId: intent.intakeId,
          operationId: intent.operationId,
          source: intent.source,
        },
        accessToken,
      );
      if (!result.ok) {
        if (result.response.status === 409)
          return { kind: "telegram-required" };
        if (result.response.status === 404) return { kind: "expired" };
        return unavailable();
      }
      const parsed = membershipSchema.safeParse(result.body);
      if (!parsed.success) return unavailable();
      store.delete(WAITLIST_INTENT_COOKIE);
      return { kind: "saved", ...parsed.data };
    },
  });
}
export function handleWaitlistWithdraw(request: Request): Promise<Response> {
  return handleMutationOperation(request, withdrawWaitlistOperation, {
    invalidInput: unavailable,
    execute: async ({ productId }, accessToken) => {
      const current = await requestProductWaitlistMembership(
        productId,
        accessToken,
      );
      if (!current.ok) return unavailable();
      const parsed = membershipSchema.safeParse(current.body);
      if (!parsed.success) return unavailable();
      const result = await requestWithdrawProductWaitlist(
        parsed.data.intakeId,
        accessToken,
      );
      if (!result.ok) return unavailable();
      const saved = membershipSchema.safeParse(result.body);
      if (!saved.success) return unavailable();
      (await cookies()).delete(WAITLIST_INTENT_COOKIE);
      return { kind: "saved", ...saved.data };
    },
  });
}
