import {
  resolveRuntimeIdentity,
  type RuntimeIdentity,
} from "@inside/runtime-identity";
import { Global, Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
  type PlatformMode,
} from "../config/platform-config.js";

export const RUNTIME_IDENTITY = Symbol("RUNTIME_IDENTITY");

export type { RuntimeIdentity } from "@inside/runtime-identity";

export function parseRuntimeIdentity(
  environment: NodeJS.ProcessEnv,
  mode: PlatformMode,
  embeddedIdentity?: RuntimeIdentity,
): RuntimeIdentity {
  return resolveRuntimeIdentity({
    ...(embeddedIdentity === undefined ? {} : { embeddedIdentity }),
    environment,
    mode,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: RUNTIME_IDENTITY,
      inject: [PLATFORM_CONFIG],
      useFactory: (config: PlatformConfig) =>
        parseRuntimeIdentity(process.env, config.mode),
    },
  ],
  exports: [RUNTIME_IDENTITY],
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest registers module metadata on the class.
export class RuntimeIdentityModule {}
