import "server-only";
import { z } from "zod";
import {
  requestAddBookmark,
  requestBookmarkStates,
  requestBookmarks,
  requestRemoveBookmark,
} from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  handleAuthenticatedMutation,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";
import {
  publishedMaterialProjectionSchema,
  toMaterialPreview,
} from "@/entities/material.model";
import { bookmarkCommandSchema, bookmarkStateSchema } from "../model/bookmark-contract";

export function handleBookmarkStates(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const ids = z.array(z.uuid()).min(1).max(100).safeParse(form.getAll("materialId"));
    if (!ids.success) return { kind: "invalid_input" };
    try {
      const result = await requestBookmarkStates(ids.data, token);
      if (!result.ok) return { kind: result.response.status === 401 ? "unauthorized" : "unavailable" };
      const parsed = z.array(bookmarkStateSchema).max(100).safeParse(result.body);
      return parsed.success ? { kind: "ready", states: parsed.data } : { kind: "unavailable" };
    } catch { return { kind: "unavailable" }; }
  });
}

export function handleSetBookmark(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = bookmarkCommandSchema.safeParse({
      materialId: form.get("materialId"),
      bookmarked: form.get("bookmarked") === "true" ? true : form.get("bookmarked") === "false" ? false : null,
    });
    if (!parsed.success) return { kind: "invalid_input" };
    try {
      const result = parsed.data.bookmarked
        ? await requestAddBookmark(parsed.data.materialId, token)
        : await requestRemoveBookmark(parsed.data.materialId, token);
      if (result.ok) {
        const state = bookmarkStateSchema.safeParse(result.body);
        return state.success ? { kind: "ready", state: state.data } : { kind: "unavailable" };
      }
      return {
        kind: result.response.status === 403
          ? "denied"
          : result.response.status === 401
            ? "unauthorized"
            : "unavailable",
      };
    } catch { return { kind: "unavailable" }; }
  });
}

const backendBookmarkPageSchema = z
  .object({
    items: z.array(publishedMaterialProjectionSchema),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();

export async function handleBookmarkList(request: Request): Promise<Response> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    return privateResponse(null, error instanceof LogtoSessionUnavailableError ? 401 : 503);
  }
  const url = new URL(request.url);
  const parsed = z
    .object({
      after: z.string().min(1).max(512).optional(),
      first: z.coerce.number().int().min(1).max(24).optional(),
    })
    .strict()
    .safeParse({
      after: url.searchParams.get("after") ?? undefined,
      first: url.searchParams.get("first") ?? undefined,
    });
  if (!parsed.success) return privateResponse(null, 400);
  try {
    const result = await requestBookmarks({
      ...(parsed.data.after === undefined ? {} : { after: parsed.data.after }),
      ...(parsed.data.first === undefined ? {} : { first: parsed.data.first }),
    }, accessToken);
    if (!result.ok) return privateResponse(null, result.response.status === 401 ? 401 : 503);
    const page = backendBookmarkPageSchema.safeParse(result.body);
    if (!page.success) return privateResponse(null, 502);
    return Response.json(
      { items: page.data.items.map(toMaterialPreview), nextCursor: page.data.nextCursor },
      { headers: { "cache-control": "no-store, private" } },
    );
  } catch { return privateResponse(null, 503); }
}

function privateResponse(body: unknown, status: number): Response {
  const headers = { "cache-control": "no-store, private" };
  return body === null
    ? new Response(null, { headers, status })
    : Response.json(body, { headers, status });
}
