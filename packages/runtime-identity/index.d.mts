import type { ZodType } from "zod";

export type RuntimeMode = "development" | "production" | "test";

export interface RuntimeIdentity {
  readonly release: string;
  readonly sourceSha: string;
}

export interface ProductionRuntimeIdentity extends RuntimeIdentity {
  readonly release: `v${number}`;
}

export const ordinalReleaseSchema: ZodType<string>;
export const sourceShaSchema: ZodType<string>;
export const sha256IdentitySchema: ZodType<string>;
export const productionRuntimeIdentitySchema: ZodType<ProductionRuntimeIdentity>;
export const runtimeIdentitySchema: ZodType<RuntimeIdentity>;

export function resolveRuntimeIdentity(input: {
  readonly embeddedIdentity?: RuntimeIdentity;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly mode: RuntimeMode;
}): RuntimeIdentity;
