import "server-only";
import { z } from "zod";
import {
  requestAddBookmark,
  requestBookmarkStates,
  requestBookmarks,
  requestRemoveBookmark,
} from "@/shared/api/backend/index.server";
import {
  handleAuthenticatedRead,
  handleMutationOperation,
} from "@/shared/auth/index.server";
import {
  publishedMaterialProjectionSchema,
  toMaterialPreview,
} from "@/entities/material.model";
import { bookmarkStateSchema } from "../model/bookmark-contract";

import {
  getBookmarkStatesOperation,
  setBookmarkOperation,
} from "./bookmarks.operation";

export function handleBookmarkStates(request: Request) {
  return handleMutationOperation(request, getBookmarkStatesOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token) => {
      try {
        const result = await requestBookmarkStates(input.materialIds, token);
        if (!result.ok)
          return {
            kind:
              result.response.status === 401 ? "unauthorized" : "unavailable",
          };
        const parsed = z
          .array(bookmarkStateSchema)
          .max(100)
          .safeParse(result.body);
        return parsed.success
          ? { kind: "ready", states: parsed.data }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}

export function handleSetBookmark(request: Request) {
  return handleMutationOperation(request, setBookmarkOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token) => {
      try {
        const result = input.bookmarked
          ? await requestAddBookmark(input.materialId, token)
          : await requestRemoveBookmark(input.materialId, token);
        if (result.ok) {
          const state = bookmarkStateSchema.safeParse(result.body);
          return state.success
            ? { kind: "ready", state: state.data }
            : { kind: "unavailable" };
        }
        return {
          kind:
            result.response.status === 403
              ? "denied"
              : result.response.status === 401
                ? "unauthorized"
                : "unavailable",
        };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}

const backendBookmarkPageSchema = z
  .object({
    items: z.array(publishedMaterialProjectionSchema),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();

export async function handleBookmarkList(request: Request): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
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
      const result = await requestBookmarks(
        {
          ...(parsed.data.after === undefined
            ? {}
            : { after: parsed.data.after }),
          ...(parsed.data.first === undefined
            ? {}
            : { first: parsed.data.first }),
        },
        accessToken,
      );
      if (!result.ok)
        return privateResponse(
          null,
          result.response.status === 401 ? 401 : 503,
        );
      const page = backendBookmarkPageSchema.safeParse(result.body);
      if (!page.success) return privateResponse(null, 502);
      return Response.json({
        items: page.data.items.map(toMaterialPreview),
        nextCursor: page.data.nextCursor,
      });
    } catch {
      return privateResponse(null, 503);
    }
  });
}

function privateResponse(body: unknown, status: number): Response {
  return body === null
    ? new Response(null, { status })
    : Response.json(body, { status });
}
