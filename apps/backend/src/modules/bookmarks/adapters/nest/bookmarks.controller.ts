import { Body, Controller, Delete, HttpCode, HttpException, Inject, Param, Post, Put, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsOneOfContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { publishedCatalogItemHttpSchema } from "../../../content-library/index.js";
import { bookmarkStateSchema } from "../../domain/bookmark.js";
import { Bookmarks } from "../../facets/bookmarks/bookmarks.js";
import { getBookmarkStatesSchema, type GetBookmarkStatesResult } from "../../features/get-bookmark-states/get-bookmark-states.js";
import type { AddBookmarkError } from "../../features/add-bookmark/add-bookmark.contract.js";
import type { ListBookmarksResult } from "../../features/list-bookmarks/list-bookmarks.contract.js";
import type { RemoveBookmarkError } from "../../features/remove-bookmark/remove-bookmark.contract.js";

const PAGE_SIZE = 12;
const listQuerySchema = z.object({
  after: z.string().min(1).max(512).optional(),
  first: z.number().int().min(1).max(24).default(PAGE_SIZE),
}).strict();
const bookmarkListPageHttpSchema = z.object({
  items: z.array(publishedCatalogItemHttpSchema),
  nextCursor: z.string().min(1).max(512).nullable(),
}).strict();

@ApiTags("Bookmarks")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiResponse({ status: 400, content: problemDetailsOneOfContent(problemDetailsSchema(400, ["invalid_request"]), accountProblemSchema) })
@ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 503, content: problemDetailsOneOfContent(problemDetailsSchema(503, ["dependency_unavailable"]), accountProblemSchema) })
@Controller("bookmarks")
export class BookmarksController {
  constructor(@Inject(Bookmarks) private readonly bookmarks: Bookmarks) {}

  @Put("materials/:materialId")
  @HttpCode(200)
  @ApiOperation({ operationId: "addMaterialBookmark", summary: "Add a Material to the current Account's bookmarks" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(bookmarkStateSchema) })
  @ApiResponse({ status: 403, content: problemDetailsContent(problemDetailsSchema(403, ["access_denied"])) })
  async add(@CurrentAccount() current: AuthenticatedAccount, @Param("materialId") materialId: string) {
    const result = await this.bookmarks.addBookmark({ materialId, accountId: current.accountId });
    if (!result.ok) throwBookmarkError(result.error);
    return result.value;
  }

  @Delete("materials/:materialId")
  @HttpCode(200)
  @ApiOperation({ operationId: "removeMaterialBookmark", summary: "Remove a Material from the current Account's bookmarks" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(bookmarkStateSchema) })
  async remove(@CurrentAccount() current: AuthenticatedAccount, @Param("materialId") materialId: string) {
    const result = await this.bookmarks.removeBookmark({ materialId, accountId: current.accountId });
    if (!result.ok) throwBookmarkError(result.error);
    return result.value;
  }

  @Post("materials/query")
  @HttpCode(200)
  @ApiOperation({ operationId: "getMaterialBookmarkStates", summary: "Read bookmark states for at most 100 Material IDs" })
  @ApiBody({ schema: toOpenApiSchema(getBookmarkStatesSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(z.array(bookmarkStateSchema)) })
  async states(@CurrentAccount() current: AuthenticatedAccount, @Body() input: unknown) {
    const parsed = getBookmarkStatesSchema.safeParse(input);
    if (!parsed.success) throwBookmarkError({ code: "invalid_request" });
    const result = await this.bookmarks.getBookmarkStates({ ...parsed.data, accountId: current.accountId });
    if (!result.ok) throwBookmarkError(result.error);
    return result.value;
  }

  @Post("query")
  @HttpCode(200)
  @ApiOperation({ operationId: "listBookmarks", summary: "List the current Account's bookmarked Materials, newest first" })
  @ApiBody({ schema: toOpenApiSchema(listQuerySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(bookmarkListPageHttpSchema) })
  async list(@CurrentAccount() current: AuthenticatedAccount, @Body() input: unknown) {
    const parsed = listQuerySchema.safeParse(input);
    if (!parsed.success) throwBookmarkError({ code: "invalid_request" });
    const result = await this.bookmarks.listBookmarks({
      first: parsed.data.first,
      accountId: current.accountId,
      ...(parsed.data.after === undefined ? {} : { after: parsed.data.after }),
    });
    if (!result.ok) throwBookmarkError(result.error);
    return result.value;
  }
}

type BookmarkError = AddBookmarkError |
  RemoveBookmarkError |
  Extract<GetBookmarkStatesResult | ListBookmarksResult, { readonly ok: false }>["error"];

function throwBookmarkError(error: BookmarkError): never {
  switch (error.code) {
    case "invalid_request": throw bookmarkException(400, error);
    case "access_denied": throw bookmarkException(403, error);
    case "dependency_unavailable": throw bookmarkException(503, error);
    default: return assertNever(error);
  }
}

function bookmarkException(status: number, error: BookmarkError): HttpException {
  return new HttpException({ type: "about:blank", title: "Bookmark request failed", status, ...error }, status);
}
function assertNever(value: never): never { throw new Error(`Unexpected Bookmark error: ${JSON.stringify(value)}`); }
