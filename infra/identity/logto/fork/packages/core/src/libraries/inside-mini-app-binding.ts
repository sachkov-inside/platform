import { createHash } from 'node:crypto';
import { z } from 'zod';

export const miniAppRequestParameter = 'inside_mini_app_request';
const scopePrefix = 'inside.mini-app.v1:';
const parametersGuard = z.object({
  client_id: z.string().min(1).max(256),
  redirect_uri: z.string().url(),
  state: z.string().min(16).max(512),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal('S256'),
  response_type: z.literal('code'),
  [miniAppRequestParameter]: z.string().uuid(),
});

/** Uses the original normal OIDC request; a social API payload cannot select this binding. */
export function miniAppConnectorScope(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null || !(miniAppRequestParameter in params)) {
    return undefined;
  }
  const context = parametersGuard.parse(params);
  const oidcContextDigest = createHash('sha256').update(JSON.stringify([
    context.client_id, context.redirect_uri, context.state, context.code_challenge,
  ])).digest('base64url');
  return `${scopePrefix}${JSON.stringify({ requestRef: context[miniAppRequestParameter], oidcContextDigest })}`;
}
