import { backendClient } from "@/shared/api/backend/index.server";

/** Нарушение через посредника: адрес каталога проверяется запросом к backend. */
export async function catalogAddressExists(pathname: string): Promise<boolean> {
  return (await backendClient.get(pathname)).ok;
}
