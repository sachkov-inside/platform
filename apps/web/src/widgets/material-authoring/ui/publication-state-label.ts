import type { MaterialPreviewPresentation } from "../model/presentation";

export function publicationStateLabel(
  state: MaterialPreviewPresentation["publicationState"],
): string {
  switch (state) {
    case "draft":
      return "черновик";
    case "published":
      return "опубликовано";
    case "unpublished":
      return "снято с публикации";
  }
}
