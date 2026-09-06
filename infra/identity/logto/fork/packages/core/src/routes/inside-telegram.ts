import { telegramSignInPage, telegramSignInScript, type InsideTelegramPresentation } from './inside-telegram-view.js';
import { z } from 'zod';
import type { AnonymousRouter, RouterInitArgs } from './types.js';

const sessionGuard = z.object({
  connectorFactoryId: z.literal('inside-telegram'), connectorId: z.string(),
  requestRef: z.string().uuid(), browserSecret: z.string().min(32),
  state: z.string(), redirectUri: z.string().url(), expiresAt: z.string().datetime(),
  confirmationCode: z.string().regex(/^\d{6}$/), deepLink: z.string().url(),
});
const configGuard = z.object({ enabled: z.boolean(), providerUrl: z.string().url(), integrationSecret: z.string().min(32) });
const statusGuard = z.object({ contractVersion: z.literal('inside.bot-sign-in.v1'), status: z.enum(['pending', 'approved', 'denied', 'expired', 'consumed', 'unavailable', 'disabled']) });
const providerTimeoutMilliseconds = 5000;

export default function insideTelegramRoutes<T extends AnonymousRouter>(...[router, tenant]: RouterInitArgs<T>) {
  router.get('/inside-telegram', async (ctx, next) => {
    ctx.set('Cache-Control', 'no-store, private');
    ctx.set('Referrer-Policy', 'no-referrer');
    ctx.type = 'html';
    ctx.body = telegramSignInPage;
    return next();
  });
  router.get('/inside-telegram/script', async (ctx, next) => {
    ctx.set('Cache-Control', 'no-store, private');
    ctx.type = 'application/javascript';
    ctx.body = telegramSignInScript;
    return next();
  });
  router.get('/inside-telegram/status', async (ctx, next) => {
    ctx.set('Cache-Control', 'no-store, private');
    ctx.set('Referrer-Policy', 'no-referrer');
    try {
      const details = await tenant.provider.interactionDetails(ctx.req, ctx.res);
      const session = sessionGuard.parse(details.result?.connectorSession);
      const connector = await tenant.connectors.getLogtoConnectorById(session.connectorId);
      const config = configGuard.parse(connector.dbEntry.config);
      if (!config.enabled) { ctx.body = { status: 'disabled' }; return next(); }
      if (Date.parse(session.expiresAt) <= Date.now()) { ctx.body = { status: 'expired' }; return next(); }
      const response = await fetch(`${config.providerUrl}/integrations/identity/v1/sign-in/${session.requestRef}/status`, {
        method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${config.integrationSecret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ contractVersion: 'inside.bot-sign-in.v1', browserSecret: session.browserSecret }),
        signal: AbortSignal.timeout(providerTimeoutMilliseconds),
      });
      if (!response.ok) throw new Error('Provider unavailable');
      const status = statusGuard.parse(await response.json());
      const callback = new URL(session.redirectUri);
      callback.searchParams.set('state', session.state);
      callback.searchParams.set('inside_state', session.state);
      callback.searchParams.set('code', session.requestRef);
      ctx.body = { status: status.status, requestRef: session.requestRef,
        ...(status.status === 'pending' ? { deepLink: session.deepLink, confirmationCode: session.confirmationCode } : {}),
        ...(status.status === 'approved' ? { callback: callback.href } : {}),
      } satisfies InsideTelegramPresentation;
    } catch { ctx.body = { status: 'unavailable' }; }
    return next();
  });
}
