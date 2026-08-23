export interface AuthorPolicy {
  canAuthor(principalId: string): boolean | Promise<boolean>;
}

export async function canAuthor(
  policy: AuthorPolicy,
  principalId: string,
): Promise<boolean> {
  try {
    return await policy.canAuthor(principalId);
  } catch {
    return false;
  }
}

export const AUTHOR_POLICY = Symbol("AUTHOR_POLICY");
