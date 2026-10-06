import { getLogtoContext } from "@logto/next/server-actions";

/** Чтение сессии мимо `@/shared/auth` не начинается с `connection()`. */
export async function readAccount(): Promise<boolean> {
  const context = await getLogtoContext({
    endpoint: "",
    appId: "",
    appSecret: "",
    baseUrl: "",
    cookieSecret: "",
    cookieSecure: true,
  });
  return context.isAuthenticated;
}
