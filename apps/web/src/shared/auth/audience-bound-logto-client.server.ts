import "server-only";

import LogtoClient from "@logto/next/server-actions";

import { bindAuthorizationCodeResource } from "./authorization-code-resource.server";
import type { ResolvedLogtoBffConfig } from "./logto-bff-config.server";

export class AudienceBoundLogtoClient extends LogtoClient {
  constructor(config: ResolvedLogtoBffConfig) {
    super(config);
    const { audience } = config;
    // @logto/client sends `resource` on authorization but omits it from the authorization-code
    // exchange. The first Platform token must be audience-bound because Logto adds our sign-in
    // proof only to that grant. Every flow of this client builds its node client from the SDK's
    // protected, per-instance `adapters.NodeClient`, so the binding lives in that class rather than
    // in one creation method; `logto-sign-in-callback.test.ts` fails if the SDK stops using it.
    const NodeClient = this.adapters.NodeClient;
    this.adapters.NodeClient = class AudienceBoundNodeClient extends (
      NodeClient
    ) {
      constructor(...parameters: ConstructorParameters<typeof NodeClient>) {
        super(...parameters);
        const request = this.adapter.requester;
        this.adapter.requester = (input, init) =>
          request(input, bindAuthorizationCodeResource(init, audience));
      }
    };
  }
}
