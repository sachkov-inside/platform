import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import {
  handleOptionalAuthenticatedMutation,
  handleAuthenticatedMutation,
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
} from "../model/product-waitlist-intent";
const intakeSchema = z.strictObject({ intakeId: z.uuid(), name: z.string() });
const membershipSchema = intakeSchema.extend({ active: z.boolean() });
const sourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/u);
const productOf = (form: FormData) =>
  z.uuid().safeParse(form.get("productId")).data;
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
      continuation: intent?.productId === productId,
    });
  });
}
export function handleWaitlistIntent(request: Request): Promise<Response> {
  return handleOptionalAuthenticatedMutation(
    request,
    async (form, accessToken) => {
      const productId = productOf(form);
      if (productId === undefined)
        return Response.json(unavailable(), { status: 400 });
      const result = await requestProductWaitlistIntake(productId);
      if (!result.ok)
        return Response.json(unavailable(), { status: result.response.status });
      const intake = intakeSchema.safeParse(result.body);
      if (!intake.success) return Response.json(unavailable(), { status: 502 });
      const account =
        accessToken === undefined ? null : await resolveAccount(accessToken);
      const config = readLogtoBffConfig();
      const token = signWaitlistIntent(
        {
          productId,
          intakeId: intake.data.intakeId,
          accountId: account?.accountId ?? null,
          source: sourceSchema.safeParse(form.get("source")).data ?? null,
        },
        config.cookieSecret,
        new Date(),
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
      });
    },
  );
}
export function handleWaitlistJoin(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (form, accessToken) => {
    const productId = productOf(form);
    const config = readLogtoBffConfig();
    const store = await cookies();
    const intent = verifyWaitlistIntent(
      store.get(WAITLIST_INTENT_COOKIE)?.value,
      config.cookieSecret,
      new Date(),
    );
    if (intent === null || intent.productId !== productId)
      return { kind: "expired" };
    const account = await resolveAccount(accessToken);
    if (intent.accountId !== null && intent.accountId !== account.accountId)
      return { kind: "expired" };
    const result = await requestJoinProductWaitlist(
      {
        intakeId: intent.intakeId,
        operationId: intent.operationId,
        source: intent.source,
      },
      accessToken,
    );
    if (!result.ok) {
      if (result.response.status === 409) return { kind: "telegram-required" };
      if (result.response.status === 404) return { kind: "expired" };
      return unavailable();
    }
    const parsed = membershipSchema.safeParse(result.body);
    if (!parsed.success) return unavailable();
    store.delete(WAITLIST_INTENT_COOKIE);
    return { kind: "saved", ...parsed.data };
  });
}
export function handleWaitlistWithdraw(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (form, accessToken) => {
    const productId = productOf(form);
    if (productId === undefined) return unavailable();
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
  });
}
