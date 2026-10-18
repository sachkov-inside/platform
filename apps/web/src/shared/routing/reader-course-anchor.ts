import { z } from "zod";
import type { Route } from "next";
import { internalRoute } from "./internal-route";

export type ReaderCourseAnchor =
  | {
      readonly kind: "material";
      readonly slug: string;
      readonly placementId?: string;
    }
  | { readonly kind: "task"; readonly code: string };

/** An anchor identifies a primary step; it never grants membership or access. */
export function parseReaderCourseAnchor(
  value: unknown,
): ReaderCourseAnchor | undefined {
  if (typeof value !== "string" || value.length > 200) return undefined;
  const match =
    /^(material|task):([a-z0-9]+(?:-[a-z0-9]+)*)(?::([^:]+))?$/u.exec(value);
  if (match?.[2] === undefined) return undefined;
  const placementId = parseReaderPlacementId(match[3]);
  if (match[3] !== undefined && placementId === undefined) return undefined;
  return match[1] === "task"
    ? { kind: "task", code: match[2] }
    : {
        kind: "material",
        slug: match[2],
        ...(placementId === undefined ? {} : { placementId }),
      };
}

/** Normalize only a validated placement identity supplied by a Reader URL. */
export function parseReaderPlacementId(value: unknown): string | undefined {
  return typeof value === "string"
    ? z.uuid().safeParse(value.toLowerCase()).data
    : undefined;
}

export function readerCourseAnchorValue(anchor: ReaderCourseAnchor): string {
  return anchor.kind === "task"
    ? `task:${anchor.code}`
    : `material:${anchor.slug}${anchor.placementId === undefined ? "" : `:${anchor.placementId}`}`;
}

/** Only local Material links inherit course context; authored fragments remain intact. */
export function anchoredMaterialHref(
  href: string,
  courseHref: Route,
  anchor?: ReaderCourseAnchor,
  referenceView = false,
): Route | undefined {
  if (!/^\/materials\/[a-z0-9]+(?:-[a-z0-9]+)*(?:[?#]|$)/u.test(href))
    return undefined;
  const url = new URL(href, "https://inside.local");
  url.searchParams.set("from", courseHref);
  if (referenceView) url.searchParams.set("view", "reference");
  if (anchor === undefined) url.searchParams.delete("anchor");
  else url.searchParams.set("anchor", readerCourseAnchorValue(anchor));
  return internalRoute(`${url.pathname}${url.search}${url.hash}`);
}
