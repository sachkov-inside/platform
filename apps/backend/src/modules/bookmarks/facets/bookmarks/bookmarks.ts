import type { BookmarksPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import type { PublishedMaterialSelection } from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
import { addBookmark } from "../../features/add-bookmark/add-bookmark.js";
import type { AddBookmarkCommand } from "../../features/add-bookmark/add-bookmark.contract.js";
import { getBookmarkStates } from "../../features/get-bookmark-states/get-bookmark-states.js";
import { listBookmarks } from "../../features/list-bookmarks/list-bookmarks.js";
import type { ListBookmarksQuery } from "../../features/list-bookmarks/list-bookmarks.contract.js";
import { removeBookmark } from "../../features/remove-bookmark/remove-bookmark.js";
import type { RemoveBookmarkCommand } from "../../features/remove-bookmark/remove-bookmark.contract.js";

export class Bookmarks {
  constructor(private readonly dependencies: {
    readonly prisma: BookmarksPrismaClient;
    readonly contentAccess: Pick<ContentAccess, "authorize" | "checkAvailabilityMany">;
    readonly selection: Pick<PublishedMaterialSelection, "read">;
    readonly videos: Pick<Videos, "loadReadyDurations">;
  }) {}

  addBookmark(command: AddBookmarkCommand) { return addBookmark(this.dependencies, command); }
  removeBookmark(command: RemoveBookmarkCommand) { return removeBookmark(this.dependencies.prisma, command); }
  getBookmarkStates(query: { readonly accountId: string; readonly materialIds: readonly string[] }) {
    return getBookmarkStates(this.dependencies.prisma, query);
  }
  listBookmarks(query: ListBookmarksQuery) { return listBookmarks(this.dependencies, query); }
}
