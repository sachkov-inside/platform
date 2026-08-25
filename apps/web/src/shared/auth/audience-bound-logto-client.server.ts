import "server-only";

import LogtoClient from "@logto/next/server-actions";

import { bindAuthorizationCodeResource } from "./authorization-code-resource.server";
import type { ResolvedLogtoBffConfig } from "./logto-bff-config.server";

export class AudienceBoundLogtoClient extends LogtoClient {
  readonly #audience: string;

  constructor(config: ResolvedLogtoBffConfig) {
    super(config);
    this.#audience = config.audience;
  }

  override async createNodeClient(
    options?: Parameters<LogtoClient["createNodeClient"]>[0],
  ): ReturnType<LogtoClient["createNodeClient"]> {
    const client = await super.createNodeClient(options);
    const request = client.adapter.requester;
    client.adapter.requester = (input, init) =>
      request(input, bindAuthorizationCodeResource(init, this.#audience));
    return client;
  }
}
