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
    ctx.body = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход через Telegram — Inside</title><style>[hidden]{display:none!important}body{font:18px/1.6 system-ui;background:#faf9f7;color:#252525;margin:0}main{max-width:460px;margin:8vh auto;padding:24px}a,button{display:inline-block;padding:12px 20px;border-radius:8px;background:#252525;color:white;text-decoration:none}p{margin:20px 0}#code{font-size:32px;letter-spacing:.15em}button{font:inherit;cursor:pointer}</style><main><h1>Вход через Telegram</h1><p>Уже есть аккаунт? Войдите по почте и подключите Telegram в кабинете. Отдельная регистрация не объединит аккаунты и покупки.</p><p>Если потеряете Telegram, вход может стать недоступен. Поддержка не гарантирует восстановление. Добавить первую почту к этому аккаунту пока нельзя.</p><p id="status" role="status">Загружаем запрос…</p><strong id="code"></strong><p><a id="bot" hidden target="_blank" rel="noreferrer">Открыть бота</a></p><p>Сверьте число в боте и подтвердите вход только для этой вкладки. Затем вернитесь сюда.</p><a href="/sign-in">Через почту</a></main><script src="/api/inside-telegram/script"></script></html>`;
    return next();
  });
  router.get('/inside-telegram/script', async (ctx, next) => {
    ctx.set('Cache-Control', 'no-store, private');
    ctx.type = 'application/javascript';
    ctx.body = `let stopped=false;async function poll(){try{const r=await fetch('/api/inside-telegram/status',{cache:'no-store'});const s=await r.json();const copy={pending:'Ожидаем подтверждение в боте',approved:'Входим…',denied:'Вы отклонили вход. Можно начать заново.',expired:'Время вышло. Начните вход заново.',consumed:'Этот запрос уже использован. Начните вход заново.',disabled:'Вход через Telegram сейчас отключён.',unavailable:'Вход сейчас недоступен. Начните заново.'};document.getElementById('status').textContent=copy[s.status]||copy.unavailable;if(s.deepLink){const a=document.getElementById('bot');a.href=s.deepLink;a.hidden=false;document.getElementById('code').textContent=s.confirmationCode;}if(s.status==='approved'&&s.callback){stopped=true;location.replace(s.callback);}else if(s.status!=='pending'){stopped=true;document.getElementById('bot').hidden=true;}}catch{document.getElementById('status').textContent='Нет связи. Пробуем ещё раз…';}if(!stopped)setTimeout(poll,1500);}poll();`;
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
      };
    } catch { ctx.body = { status: 'unavailable' }; }
    return next();
  });
}
