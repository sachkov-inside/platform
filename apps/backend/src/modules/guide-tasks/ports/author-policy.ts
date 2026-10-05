/** Whether an Account may import Guide Tasks: the `materials:manage` permission. */
export interface AuthorPolicy {
  canManage(accountId: string): boolean | Promise<boolean>;
}
