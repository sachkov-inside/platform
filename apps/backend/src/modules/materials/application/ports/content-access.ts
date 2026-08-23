import type { MaterialAccess } from "../../domain/material-revision-metadata.js";
import { authorizeAuthor, type AuthorPolicy } from "./author-policy.js";

export type Subject =
  | { readonly kind: "anonymous" }
  | { readonly kind: "principal"; readonly principalId: string };

export const anonymousSubject: Subject = Object.freeze({ kind: "anonymous" });

export interface MaterialBodyResource {
  readonly kind: "material_body";
  readonly materialId: string;
  readonly revisionId: string;
  readonly publication: "draft" | "published";
  readonly access: MaterialAccess;
}

export type AccessDecision =
  | { readonly allowed: true; readonly reason: "author" | "public" }
  | {
      readonly allowed: false;
      readonly reason: "forbidden" | "membership_required" | "temporarily_unavailable";
    };

export interface ContentAccess {
  authorize(request: {
    readonly subject: Subject;
    readonly action: "preview" | "read";
    readonly resource: MaterialBodyResource;
  }): Promise<AccessDecision>;
}

export function createBaselineContentAccess(authorPolicy: AuthorPolicy): ContentAccess {
  return {
    async authorize({ subject, action, resource }) {
      if (action === "read" && resource.publication === "published" && resource.access === "free") {
        return { allowed: true, reason: "public" };
      }
      if (subject.kind === "principal") {
        const authorization = await authorizeAuthor(
          authorPolicy,
          subject.principalId,
        );
        if (authorization.ok) {
          return { allowed: true, reason: "author" };
        }
        if (authorization.error.code === "dependency_unavailable") {
          return { allowed: false, reason: "temporarily_unavailable" };
        }
      }
      return {
        allowed: false,
        reason: resource.access === "membership" ? "membership_required" : "forbidden",
      };
    },
  };
}

export const CONTENT_ACCESS = Symbol("CONTENT_ACCESS");
