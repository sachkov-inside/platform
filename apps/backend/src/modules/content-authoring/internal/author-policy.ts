export interface AuthorPolicy {
  canAuthor(principalId: string): boolean | Promise<boolean>;
}

export const AUTHOR_POLICY = Symbol("AUTHOR_POLICY");
