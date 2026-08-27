import type { MaterialAccess } from "../domain/material-metadata.js";
import type { PublicationState } from "../domain/material.js";
import { authorizeManager, type AuthorPolicy } from "./author-policy.js";

export type Subject =
  | { readonly kind: "anonymous" }
  | { readonly kind: "account"; readonly accountId: string };

export const anonymousSubject: Subject = Object.freeze({ kind: "anonymous" });

export interface MaterialBodyResource {
  readonly kind: "material_body";
  readonly materialId: string;
  readonly contentVersion: number;
  readonly publication: PublicationState;
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

export function assembleBaselineContentAccess(authorPolicy: AuthorPolicy): ContentAccess {
  return {
    async authorize({ subject, action, resource }) {
      if (action === "read" && resource.publication === "published" && resource.access === "free") {
        return { allowed: true, reason: "public" };
      }
      if (subject.kind === "account") {
        const authorization = await authorizeManager(
          authorPolicy,
          subject.accountId,
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
