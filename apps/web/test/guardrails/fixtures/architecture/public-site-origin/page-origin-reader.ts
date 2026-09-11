import { readWebRuntimeConfig } from "@/shared/config/index.server";

export function canonicalUrl(path: string): string {
  return new URL(path, readWebRuntimeConfig().identity.baseUrl).toString();
}
