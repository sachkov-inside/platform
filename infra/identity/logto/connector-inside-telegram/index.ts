import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ConnectorError, ConnectorErrorCodes, ConnectorPlatform, ConnectorType, type CreateConnector, type SocialConnector } from '@logto/connector-kit';
import { z } from 'zod';

const contractVersion = 'inside.bot-sign-in.v1';
const requestLifetimeMinutes = 5;
const providerTimeoutMilliseconds = 5000;
const configGuard = z.object({
  enabled: z.boolean().default(false),
  miniAppEnabled: z.boolean().default(false),
  platformUrl: z.string().url(),
  issuer: z.string().url(),
  providerUrl: z.string().url(),
  integrationSecret: z.string().min(32),
  botUsername: z.string().regex(/^[a-zA-Z0-9_]{5,32}$/),
});
const sessionGuard = z.object({
  connectorFactoryId: z.literal('inside-telegram'),
  state: z.string().min(1), redirectUri: z.string().url(),
  requestRef: z.string().uuid(), browserSecret: z.string().min(32),
  expiresAt: z.string().datetime(),
});
const proofGuard = z.object({
  contractVersion: z.literal(contractVersion),
  status: z.literal('verified'), subjectRef: z.string().uuid(),
  approvedAt: z.string().datetime(),
  existingLink: z.object({ accountRef: z.string().uuid(), telegramIdentityRef: z.string().uuid() }).nullable(),
}).strict();
const miniAppScopePrefix = 'inside.mini-app.v1:';
const miniAppScopeGuard = z.object({
  requestRef: z.string().uuid(), oidcContextDigest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  launchBrowserSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const failure = () => new ConnectorError(ConnectorErrorCodes.AuthorizationFailed, 'Telegram sign-in unavailable');

const createConnector: CreateConnector<SocialConnector> = async ({ getConfig }) => {
  const readConfig = async () => {
    const config = configGuard.parse(await getConfig('inside-telegram'));
    if (!config.enabled) throw failure();
    return config;
  };
  const request = async (path: string, body: unknown) => {
    const config = await readConfig();
    const response = await fetch(`${config.providerUrl}/integrations/identity/v1/sign-in${path}`, {
      method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${config.integrationSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(providerTimeoutMilliseconds),
    });
    if (!response.ok) throw failure();
    return response.json() as Promise<unknown>;
  };
  return {
    type: ConnectorType.Social,
    metadata: {
      id: 'inside-telegram', target: 'inside-telegram', platform: ConnectorPlatform.Universal,
      name: { en: 'Telegram', ru: 'Telegram' },
      description: { en: 'Confirm sign-in in the Inside bot' }, logo: './logo.svg', logoDark: null, readme: './README.md',
    },
    configGuard,
    async getAuthorizationUri(payload, setSession) {
      const config = await readConfig();
      let browserSecret = randomBytes(32).toString('base64url');
      const { scope, ...sessionPayload } = payload;
      if (scope?.startsWith(miniAppScopePrefix)) {
        if (!config.miniAppEnabled) throw failure();
        const context = miniAppScopeGuard.parse(JSON.parse(scope.slice(miniAppScopePrefix.length)));
        // Repeating this native interaction after an unknown bind outcome must not choose a
        // different secret. Its purpose, attempt, OIDC transcript and native jti separate the key.
        browserSecret = createHmac('sha256', context.launchBrowserSecret).update(JSON.stringify([
          'inside.mini-app.connector.v1', context.requestRef, context.oidcContextDigest, z.string().min(1).parse(payload.jti),
        ])).digest('base64url');
        const bound = z.object({
          contractVersion: z.literal('inside.mini-app-sign-in.v1'), status: z.literal('bound'), expiresAt: z.string().datetime(),
        }).strict().parse(await request(`/mini-app/${context.requestRef}/bind`, {
          contractVersion: 'inside.mini-app-sign-in.v1', oidcContextDigest: context.oidcContextDigest,
          browserSecretDigest: digest(browserSecret),
          launchBrowserSecret: context.launchBrowserSecret,
        }));
        if (Date.parse(bound.expiresAt) <= Date.now()) throw failure();
        await setSession({ ...sessionPayload, requestRef: context.requestRef, browserSecret, expiresAt: bound.expiresAt });
        const callback = new URL(payload.redirectUri);
        callback.searchParams.set('state', payload.state);
        callback.searchParams.set('inside_state', payload.state);
        callback.searchParams.set('code', context.requestRef);
        return callback.href;
      }
      const requestRef = randomUUID();
      const startToken = randomBytes(26).toString('base64url');
      const expiresAt = new Date(Date.now() + requestLifetimeMinutes * 60 * 1000).toISOString();
      const registered = z.object({
        contractVersion: z.literal(contractVersion), status: z.literal('registered'),
        confirmationCode: z.string().regex(/^\d{6}$/), expiresAt: z.string().datetime(),
      }).strict().parse(await request('', {
        contractVersion, requestRef, startTokenDigest: digest(startToken), browserSecretDigest: digest(browserSecret), expiresAt,
      }));
      await setSession({
        ...sessionPayload, requestRef, browserSecret, expiresAt,
        confirmationCode: registered.confirmationCode,
        deepLink: `https://t.me/${config.botUsername}?start=signin_${startToken}`,
      });
      return `${new URL(payload.redirectUri).origin}/api/inside-telegram`;
    },
    async getUserInfo(data, getSession) {
      await readConfig();
      const callback = z.object({ inside_state: z.string(), code: z.string().uuid() }).parse(data);
      const session = sessionGuard.parse(await getSession());
      if (callback.inside_state !== session.state || callback.code !== session.requestRef || Date.parse(session.expiresAt) <= Date.now()) throw failure();
      const binding = { contractVersion, browserSecret: session.browserSecret };
      let proof;
      try {
        proof = proofGuard.parse(await request(`/${session.requestRef}/consume`, binding));
      } catch {
        // A timeout can follow a committed consume. The authenticated receipt only reads that
        // exact attempt and cannot consume another proof or create a new subject.
        proof = proofGuard.parse(await request(`/${session.requestRef}/receipt`, binding));
      }
      return { id: proof.subjectRef, rawData: { requestRef: session.requestRef, existingLink: proof.existingLink } };
    },
  };
};
export default createConnector;
