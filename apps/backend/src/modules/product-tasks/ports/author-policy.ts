/** Whether an Account may import Product Tasks: the `materials:manage` permission. */
export interface AuthorPolicy {
  canManage(accountId: string): boolean | Promise<boolean>;
}
