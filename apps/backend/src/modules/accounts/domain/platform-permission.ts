export const platformPermissions = [
  "materials:manage",
  "communications:manage",
  "platform:admin",
] as const;
export type PlatformPermission = (typeof platformPermissions)[number];
export function isPlatformPermission(
  value: string,
): value is PlatformPermission {
  return platformPermissions.some((permission) => permission === value);
}
