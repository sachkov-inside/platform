export interface AuthorPolicy {
  canAuthor(principalId: string): boolean | Promise<boolean>;
  canPublish?(principalId: string): boolean | Promise<boolean>;
}

export async function canPublish(
  policy: AuthorPolicy,
  principalId: string,
): Promise<boolean> {
  try {
    return policy.canPublish === undefined
      ? false
      : await policy.canPublish(principalId);
  } catch {
    return false;
  }
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
